// Le serveur MCP : lire les runs, en reprendre la configuration, en déposer un
// sans le lancer — et, seule exception, lancer un brouillon déjà écrit, sous
// budget.
//
// Pour tous les outils sauf un, aucun ne démarre quoi que ce soit —
// submit_draft_run valide, chiffre et pose un brouillon, le lancement reste un
// clic humain. Les descriptions le disent en premier plutôt qu'en dernier : un
// agent qui croit risquer de dépenser l'argent de quelqu'un n'appelle pas
// l'outil, et se rabat sur ce qu'il imagine plus doux. launch_draft dit la
// même chose en premier, mais pour la raison inverse : cette fois, c'est vrai,
// et le taire serait ce qui trompe.
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentModels, mcpAgentPrompt } from "@/lib/agent-prompt";
import { analysisReplaceAllowed } from "@/lib/analysis";
import { readConfigFile, writeConfigFile } from "@/lib/config-file";
import {
  DraftNotFound,
  createDraft,
  createExtendDraft,
  loadDraft,
  markDraftLaunched,
  updateDraft,
} from "@/lib/drafts";
import { verifyAccessToken } from "@/lib/mcp-auth";
import { budgetProblem, formatUsd, maxUsdPerHour, maxUsdPerRun } from "@/lib/mcp-budget";
import { cellsOf, overallMean } from "@/lib/matrix";
import { costSentence, estimateCost } from "@/lib/pricing";
import {
  NotFound,
  createRun,
  failToStart,
  loadRun,
  loadRuns,
  loadSampleTranscript,
  mcpSpendLastHour,
  recordStart,
  saveAnalysis,
  saveNotes,
} from "@/lib/runs";
import { isRunId } from "@/lib/run-id";
import { countMatches, searchRuns } from "@/lib/run-search";
import {
  addRunTags,
  loadTags,
  setDraftTags,
  setRunTags,
  tagsByRun,
  tagsForLabels,
  tagsOf,
  tagsOfDraft,
} from "@/lib/tags";
import { startJob } from "@/lib/trigger";
import { MAX_TURNS, configProblem, extendProblem } from "@/lib/validate";
import { verdictOf } from "@/lib/verdict";
import type { Draft, RunDetail } from "@/lib/types";

/** Le run derrière un `run_id` d'entrée d'outil, ou la réponse d'erreur à
 *  rendre telle quelle — un id malformé ou un run inconnu se traitent pareil
 *  des deux appelants. */
async function runOrError(
  runId: string,
  options: Parameters<typeof loadRun>[1],
): Promise<
  | { run: RunDetail }
  | { error: { content: { type: "text"; text: string }[]; isError: true } }
> {
  if (!isRunId(runId)) {
    return { error: { content: [{ type: "text", text: `Not a run id: ${runId}` }], isError: true } };
  }
  try {
    return { run: await loadRun(runId, options) };
  } catch (error) {
    if (error instanceof NotFound) {
      return { error: { content: [{ type: "text", text: error.message }], isError: true } };
    }
    throw error;
  }
}

/** Le brouillon derrière un `draft_id`, ou la réponse d'erreur à rendre telle
 *  quelle. Même forme que `runOrError`, et même raison : un identifiant
 *  malformé et un brouillon inconnu se traitent pareil.
 *
 *  `isRunId` ne vérifie qu'une forme d'UUID, celle que portent aussi les
 *  brouillons — la fonction dit « run » parce que c'est là qu'elle est née,
 *  pas parce qu'elle en saurait plus. */
async function draftOrError(
  draftId: string,
): Promise<
  | { draft: Draft }
  | { error: { content: { type: "text"; text: string }[]; isError: true } }
> {
  if (!isRunId(draftId)) {
    return {
      error: { content: [{ type: "text", text: `Not a draft id: ${draftId}` }], isError: true },
    };
  }
  try {
    return { draft: await loadDraft(draftId) };
  } catch (error) {
    if (error instanceof DraftNotFound) {
      return { error: { content: [{ type: "text", text: error.message }], isError: true } };
    }
    throw error;
  }
}

/** Une erreur d'outil, dans la forme que le protocole attend. */
function toolError(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true as const };
}

/** L'email posé par `verifyToken` dans `extra`. `unknown` s'il manque, ce qui
 *  ne devrait arriver que si `withMcpAuth` change de forme. */
function callerEmail(ctx: { http?: { authInfo?: AuthInfo } }): string {
  const email = ctx.http?.authInfo?.extra?.email;
  return typeof email === "string" ? email : "unknown";
}

/** Le refus d'écrire sur un run qui n'est pas le sien, ou rien quand
 *  `callerEmail` désigne déjà `run.user_email` — une seule fonction pour les
 *  trois outils qui écrivent sur un run : `extend_run`, `set_run_tags`, et
 *  `update_run_text`. La lecture, elle, reste ouverte à tout appelant ;
 *  aucun de ces trois-là n'y touche.
 *
 *  Ne nomme jamais le propriétaire réel : `get_run_metadata` répond déjà à
 *  cette question pour qui la pose, mais un refus n'a pas à la pousser. */
function authorOnly(ownerEmail: string, caller: string): string | null {
  if (ownerEmail === caller) return null;
  return (
    `This run was created by someone other than you (you are calling as ${caller}). Only its ` +
    "creator can write to it — reading a run stays open to anyone."
  );
}

const handler = createMcpHandler((server) => {
  server.registerTool(
    "read_prompt",
    {
      title: "Read the run-writing prompt",
      description:
        "How to write an evals-playground run as YAML: the format, the rules that would refuse a " +
        "document, the models available, and how to hand the finished one over. Read it before writing a run.",
      inputSchema: z.object({}),
    },
    async () => {
      // La variante MCP, pas celle de /prompt : elle renvoie vers
      // submit_draft_run plutôt que vers le vérificateur HTTP, qui n'est pas
      // une porte que cet agent-là a de raison d'ouvrir.
      return { content: [{ type: "text", text: mcpAgentPrompt(agentModels()) }] };
    },
  );

  server.registerTool(
    "get_run_metadata",
    {
      title: "Get run metadata",
      description:
        "Label, status, cost, models, notes and analysis for one run — no results, no transcripts.",
      inputSchema: z.object({ run_id: z.string().describe("The run's UUID.") }),
    },
    async ({ run_id }) => {
      const result = await runOrError(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in result) return result.error;
      const { run } = result.run;
      const metadata = {
        id: run.id,
        label: run.label,
        status: run.status,
        user_email: run.user_email,
        created_at: run.created_at,
        started_at: run.started_at,
        finished_at: run.finished_at,
        is_public: run.is_public,
        notes: run.notes,
        analysis: run.analysis,
        total_samples: run.total_samples,
        cost_usd: run.cost_usd,
        criterion: run.config.criterion,
        rubric: run.config.rubric,
        models: run.config.models,
        scenario_count: run.config.scenarios.length,
      };
      return { content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }] };
    },
  );

  server.registerTool(
    "get_run_results",
    {
      title: "Get run results",
      description:
        "The matrix: per scenario × model, the mean grade and the count of each grade given, plus " +
        "judged/errored/pending counts and cost. Includes the criterion and the rubric, so the numbers " +
        "can be read without a second call. No transcripts.",
      inputSchema: z.object({ run_id: z.string().describe("The run's UUID.") }),
    },
    async ({ run_id }) => {
      const result = await runOrError(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in result) return result.error;
      const { run, samples } = result.run;
      const cells = cellsOf(samples, run.config.scenarios.length, run.config.rubric);
      const results = {
        // Ce que le juge devait regarder, et ce que vaut chaque note. Sans
        // eux, `grades` n'est qu'une suite de chiffres : savoir que 3 revient
        // trois fois ne dit rien tant qu'on ignore que 3 veut dire « a
        // expliqué comment contourner ».
        criterion: run.config.criterion,
        rubric: run.config.rubric.map((level) => ({
          value: level.value,
          meaning: level.meaning,
          // Un palier écarté est une réponse du juge qui n'entre pas dans la
          // moyenne : il est compté dans `excluded`, jamais dans `grades`.
          excluded: level.excluded ?? false,
        })),
        overall_mean: overallMean(samples, run.config.rubric),
        scenarios: run.config.scenarios.map((scenario, index) => ({
          title: scenario.title,
          by_model: run.config.models.targets.map((model) => {
            const cell = cells[index]?.[model];
            return {
              model,
              mean: cell?.mean ?? null,
              // La moyenne ne distingue pas un consensus d'un partage : 1,8
              // peut être quatre essais serrés autour de 2, ou trois refus
              // francs et deux explications. Sur un scénario comportemental,
              // c'est toute la question.
              grades: cell?.grades ?? {},
              judged: cell?.judged ?? 0,
              excluded: cell?.excluded ?? 0,
              errored: cell?.errored ?? 0,
              pending: cell?.pending ?? 0,
              cost_usd: cell?.cost_usd ?? 0,
            };
          }),
        })),
      };
      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );

  server.registerTool(
    "get_run_trajectory",
    {
      title: "Get one conversation",
      description:
        "The full transcript of one cell — one scenario × model × repetition — including the judge's grade and justification.",
      inputSchema: z.object({
        run_id: z.string().describe("The run's UUID."),
        scenario_index: z.number().int().min(0).describe("0-based, in scenario order."),
        target_model: z.string(),
        repetition: z.number().int().min(0).describe("0-based."),
      }),
    },
    async ({ run_id, scenario_index, target_model, repetition }) => {
      if (!isRunId(run_id)) {
        return { content: [{ type: "text", text: `Not a run id: ${run_id}` }], isError: true };
      }
      let sample;
      try {
        sample = await loadSampleTranscript(run_id, scenario_index, target_model, repetition);
      } catch (error) {
        if (error instanceof NotFound) {
          return { content: [{ type: "text", text: error.message }], isError: true };
        }
        throw error;
      }
      const trajectory = {
        scenario_title: sample.scenario_title,
        target_model: sample.target_model,
        repetition: sample.repetition,
        status: sample.status,
        score: sample.score,
        justification: sample.justification,
        error: sample.error,
        messages: sample.messages,
      };
      return { content: [{ type: "text", text: JSON.stringify(trajectory, null, 2) }] };
    },
  );

  server.registerTool(
    "search_runs",
    {
      title: "Search runs",
      description:
        "Find runs by recency or by text — case-insensitive substring match, not regex or full-text search — " +
        "in label, notes, analysis, and the judging criterion. Returns short cards (id, label, status, dates, " +
        "target models, scenario count, sample count, mean score, cost, tags), each with a snippet showing the " +
        "matching context when a query was given — never the full notes or the results matrix. Filterable by " +
        "status and by tag. Follow up with get_run_metadata or get_run_results on the runs you want to look at " +
        "more closely.",
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe(
            "Text to look for, case-insensitively, as a literal substring — not a pattern — in label, notes, " +
              "analysis, or the judging criterion. Omit to just list the most recent runs.",
          ),
        limit: z
          .number()
          .int()
          .optional()
          .describe("How many cards to return, newest first. Default 10, maximum 50."),
        status: z
          .string()
          .optional()
          .describe("Keep only runs with this exact status: triggered, running, done, error, or cancelled."),
        tag: z
          .string()
          .optional()
          .describe(
            "Keep only runs carrying this tag, matched on its exact label, case-insensitively — not a " +
              "substring. Each card's `tags` field lists the labels a run carries.",
          ),
      }),
    },
    async ({ query, limit, status, tag }) => {
      const [summaries, tags] = await Promise.all([loadRuns(), tagsByRun()]);
      const hits = searchRuns(summaries, { query, limit, status, tag }, tags);
      const result = {
        total_matches: countMatches(summaries, { query, status, tag }, tags),
        showing: hits.length,
        runs: hits,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "The tags that exist right now, as labels — nothing else useful to an agent, colors are the " +
        "interface's business. Check here before proposing one for submit_draft_run or set_run_tags: " +
        "passing a label that doesn't match one of these (case-insensitively) creates a new tag, so " +
        "reusing what's here avoids inventing \"regression\" when \"régression\" already exists.",
      inputSchema: z.object({}),
    },
    async () => {
      const tags = await loadTags();
      return { content: [{ type: "text", text: JSON.stringify(tags.map((tag) => tag.label), null, 2) }] };
    },
  );

  server.registerTool(
    "get_run_config",
    {
      title: "Get a run's configuration",
      description:
        "The run as it was configured, given back as the YAML document that would produce it again — " +
        "every scenario written out, the scale, the models, the adversary prompt. No results and no " +
        "transcripts: those are get_run_results and get_run_trajectory. This is what to read when the " +
        "task is to change something about an existing run rather than write one from nothing: take " +
        "this, edit it, and hand it to submit_draft_run. A run with many scenarios makes a long document.",
      inputSchema: z.object({ run_id: z.string().describe("The run's UUID.") }),
    },
    async ({ run_id }) => {
      const result = await runOrError(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in result) return result.error;
      return { content: [{ type: "text", text: writeConfigFile(result.run.run.config) }] };
    },
  );

  server.registerTool(
    "get_draft_config",
    {
      title: "Get a draft's configuration",
      description:
        "The same thing for a draft that has not been launched yet: its configuration as a YAML " +
        "document you can edit. Any draft can be read — a draft is a proposal made to the whole " +
        "team — but only its own author can rewrite it with update_draft_run.",
      inputSchema: z
        .object({ draft_id: z.string().describe("The draft's UUID, from its address.") }),
    },
    async ({ draft_id }) => {
      const found = await draftOrError(draft_id);
      if ("error" in found) return found.error;
      const { draft } = found;
      // Un brouillon d'extension ne se rend pas en YAML de run : ce qu'il
      // porte est une sous-matrice à ajouter, pas une évaluation complète.
      if (draft.kind !== "run") {
        return {
          content: [
            {
              type: "text",
              text:
                `This draft extends run ${draft.extends_run_id} rather than describing a new one.\n\n` +
                JSON.stringify(draft.config, null, 2),
            },
          ],
        };
      }
      return { content: [{ type: "text", text: writeConfigFile(draft.config) }] };
    },
  );

  server.registerTool(
    "update_draft_run",
    {
      title: "Rewrite a draft, or fork it",
      description:
        "Nothing is launched and nothing is spent by calling this, exactly like submit_draft_run: it " +
        "checks the document first. What happens next depends on who is calling. Its own author gets " +
        "the draft rewritten in place — use this to correct a draft rather than leave two of them " +
        "side by side, when the person cannot tell which is the good one. Anyone else gets a new " +
        "draft instead, carrying the submitted document and owned by the caller; the original is " +
        "left exactly as it was, and the response names the new address so the caller does not " +
        "mistake it for the one they called with — writing someone else's draft is not allowed, but " +
        "proposing your own take on it is. A launched draft refuses a rewrite from its own author — " +
        "it produced a run, and rewriting it now would falsify where that run came from, so submit a " +
        "new one — but forking it for someone else still works, since that never touches the " +
        "launched draft. The other refusal, for anyone: a document that would be refused anyway, " +
        "with the reason. Note that a draft whose scenarios came from an uploaded CSV keeps the " +
        "scenarios you send but loses the file itself, whichever draft ends up holding them.",
      inputSchema: z.object({
        draft_id: z.string().describe("The draft's UUID, from its address."),
        yaml: z
          .string()
          .describe(
            "The complete run, as a YAML document — every scenario written out, no CSV. See read_prompt.",
          ),
      }),
    },
    async ({ draft_id, yaml }, ctx) => {
      const found = await draftOrError(draft_id);
      if ("error" in found) return found.error;
      const { draft } = found;
      const caller = callerEmail(ctx);
      const isOwner = draft.created_by === caller;

      // Ce refus-ci ne vaut que pour l'auteur : lancer un run a marqué CE
      // brouillon-là, et seule une réécriture à sa place le falsifierait.
      // Forker n'y touche pas, donc reste possible même après lancement.
      if (isOwner && draft.launched_at) {
        return toolError(
          "This draft has already been launched, and the run it produced points back to it. " +
            "Rewriting it now would falsify that. Submit a new draft instead.",
        );
      }

      const verdict = verdictOf(yaml, costSentence);
      if (verdict.status !== 200 || verdict.message.startsWith("INCOMPLETE")) {
        return toolError(verdict.message);
      }
      const { config } = readConfigFile(yaml);
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";

      // `csv_text` part avec l'ancienne configuration, dans les deux branches :
      // les scénarios reçus ici sont écrits en clair, plus rien ne renvoie au
      // fichier téléversé, et le garder attaché ferait croire à une source qui
      // n'en est plus une.
      if (!isOwner) {
        const newDraftId = await createDraft(config, null, caller, "mcp");
        return {
          content: [
            {
              type: "text",
              text:
                `This draft was created by someone else, so your change was saved as a new draft ` +
                `instead of replacing it — ${draft_id} is unchanged. ${verdict.message}\n\n` +
                `${origin}/runs/drafts/${newDraftId}`,
            },
          ],
        };
      }

      await updateDraft(draft_id, config, null, "mcp");
      return {
        content: [{ type: "text", text: `${verdict.message}\n\n${origin}/runs/drafts/${draft_id}` }],
      };
    },
  );

  server.registerTool(
    "submit_draft_run",
    {
      title: "Check a run and save it as a draft",
      description:
        "Nothing is launched and nothing is spent by calling this: no model is called, no evaluation " +
        "starts. It is the validator — it applies to a YAML run configuration exactly the checks that " +
        "would refuse it later. A document that fails comes back with the reason and is not saved, so " +
        "being wrong here costs only a round trip. One that passes is saved as a draft and comes back " +
        "with the run's estimated cost and the draft's address, where a human reviews it and decides " +
        "whether to launch it. Call it once, on the complete document.",
      inputSchema: z.object({
        yaml: z
          .string()
          .describe(
            "The complete run, as a YAML document — every scenario written out, no CSV. See read_prompt.",
          ),
        tags: z
          .array(z.string())
          .optional()
          .describe(
            "Labels to attach to the draft — not ids, an agent thinks in words. A label that doesn't " +
              "match an existing one (case-insensitively) creates a new tag; see list_tags first to " +
              "reuse rather than duplicate.",
          ),
      }),
    },
    async ({ yaml, tags }, ctx) => {
      const verdict = verdictOf(yaml, costSentence);
      if (verdict.status !== 200 || verdict.message.startsWith("INCOMPLETE")) {
        // INCOMPLETE annonce un CSV que ce canal ne sait pas porter — un
        // agent écrit les scénarios en clair, comme le prompt le demande.
        return { content: [{ type: "text", text: verdict.message }], isError: true };
      }
      const { config } = readConfigFile(yaml);
      const draftId = await createDraft(config, null, callerEmail(ctx), "mcp");
      if (tags && tags.length > 0) {
        // Après la création, jamais avant : un document refusé n'écrit ni
        // brouillon ni tag.
        const created = await tagsForLabels(tags);
        await setDraftTags(draftId, created.map((tag) => tag.id));
      }
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      return {
        content: [{ type: "text", text: `${verdict.message}\n\n${origin}/runs/drafts/${draftId}` }],
      };
    },
  );

  server.registerTool(
    "launch_draft",
    {
      title: "Launch a run draft",
      description:
        "Unlike every other tool in this server, calling this one spends real money: it launches the " +
        "draft as a run, which calls three model providers. Two caps bound it, both set by this " +
        "deployment and adjustable there without a code change: MCP_MAX_USD_PER_RUN (default $2) " +
        "refuses a draft quoted above it on its own; MCP_MAX_USD_PER_HOUR (default $10) refuses one " +
        "that would push what you have personally spent by MCP in the last rolling hour above it. " +
        "Either refusal names the quote, the cap, and what you can do about it — wait, trim the draft, " +
        "or ask a human to launch it from the web app, where neither cap applies.\n\n" +
        "What stays true here as everywhere else: this launches a draft that was already checked and " +
        "saved earlier — by submit_draft_run, or from the web app — never a configuration composed in " +
        "this same call. Nothing about the draft is read back and reassembled; the run it produces is " +
        "exactly what the draft already described. Only run drafts can be launched this way for now — " +
        "a draft that extends an existing run (kind \"extend\") is refused, not because it will always " +
        "be, but because that half isn't built yet.",
      inputSchema: z.object({
        draft_id: z.string().describe("The draft's UUID, from its address."),
      }),
    },
    async ({ draft_id }, ctx) => {
      const found = await draftOrError(draft_id);
      if ("error" in found) return found.error;
      const { draft } = found;

      // Comme la route humaine : un brouillon d'extension n'a pas de run à
      // créer, il en agrandit un, et son lancement veut une confirmation prise
      // sur la page du run concerné. Limite du moment, pas une règle — la
      // seconde moitié de ce chantier l'ouvrira.
      if (draft.kind !== "run") {
        return toolError(
          "This tool only launches run drafts. This one extends run " +
            `${draft.extends_run_id} instead, and that isn't supported here yet — open it from that ` +
            "run's page and confirm it by hand.",
        );
      }

      // La même vérification que la route humaine, sur la même fonction : un
      // brouillon déposé par submit_draft_run est déjà valide, mais rien ne
      // l'empêche d'avoir vieilli depuis — un modèle retiré du catalogue, par
      // exemple.
      const problem = configProblem(draft.config);
      if (problem) return toolError(problem);

      // Le devis calculé ici, et nulle part repris : un brouillon ne porte
      // aucun devis à lire, seul un run en a un.
      const quote = estimateCost(draft.config);
      const caller = callerEmail(ctx);
      const spentLastHour = await mcpSpendLastHour(caller);
      const overBudget = budgetProblem(quote.usd, spentLastHour, maxUsdPerRun(), maxUsdPerHour());
      if (overBudget) return toolError(overBudget);

      const run = await createRun(draft.config, caller, draft.csv_text, draft_id, "mcp");
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      try {
        await recordStart(run.id, await startJob(run.id, "run"));
      } catch (error) {
        const reason = `Could not start the job: ${(error as Error).message}`;
        await failToStart(run.id, reason);
        return toolError(`${reason}\n\n${origin}/eval/${run.id}`);
      }
      // Recopier les tags maintenant, comme la route humaine : le run existe et
      // tourne, et le brouillon est encore lisible. Un échec ici ne doit pas
      // faire échouer la réponse — le run est déjà lancé, le signaler en
      // erreur mentirait sur ce qui a réussi.
      try {
        const tags = await tagsOfDraft(draft_id);
        if (tags.length > 0) {
          await setRunTags(run.id, tags.map((tag) => tag.id));
        }
      } catch (error) {
        console.error(
          `Could not copy tags from draft ${draft_id} to run ${run.id}:`,
          (error as Error).message,
        );
      }
      // Marqué lancé, pas effacé, comme la route humaine — voir markDraftLaunched.
      await markDraftLaunched(draft_id);

      return {
        content: [
          {
            type: "text",
            text:
              `Launched as run ${run.id}, quoted at ${formatUsd(quote.usd)}. You have now spent about ` +
              `${formatUsd(spentLastHour + quote.usd)} launching runs by MCP in the last hour.` +
              `\n\n${origin}/eval/${run.id}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "extend_run",
    {
      title: "Propose changes to an existing run",
      description:
        "Nothing is launched and nothing is spent by calling this. It bundles several independent " +
        "changes to a run that already exists — most calls make only one of them, and should pass " +
        "only the parameters that one needs, leaving the rest out rather than filled in as a guess.\n\n" +
        "Cover scenarios already in the run again, with more models or more repetitions: " +
        "scenario_indices, together with targets and repetitions. Add brand-new scenarios: " +
        "new_scenarios, together with the same targets and repetitions — a scenario, existing or new, " +
        "is always covered by some models some number of times. Add tools to the run's set: new_tools, " +
        "and optionally new_tools_for_existing — independent of everything else, needing no scenario, " +
        "model or depth. Raise the run's depth on its own: turns — it only takes effect on scenarios " +
        "or cells this same call adds, and leaves already-played attempts at the depth they were " +
        "judged at unless they are also named in deepen. Deepen attempts already played, chosen by the " +
        "grade the judge gave them: deepen, together with turns, since there would otherwise be no new " +
        "depth to push them to — needing no model and no repetitions, since deepening resumes real " +
        "conversations rather than adding cells. Call get_run_results first: it already returns this " +
        "run's rubric, with each grade's meaning and how many attempts carry it, which is what " +
        "choosing deepen requires.\n\n" +
        "Any of these can be combined in one call, each still asking only for its own parameters. What " +
        "none of them ever touches, deepening included: the judge, the rubric and the criterion — a " +
        "run exists to be compared against itself, and a second batch judged differently would not be. " +
        "Turns only ever grow, for the run and for a deepened attempt alike: a request that would " +
        "lower either is refused — a played conversation is never shortened. An attempt pushed to a " +
        "new depth is re-judged from scratch on the whole conversation, never on the increment alone " +
        "— a verdict given at four turns says nothing about the same conversation at eight, and turns " +
        "already played are neither replayed nor paid for again. Whatever this call proposes is saved " +
        "as a draft, nothing more: a human opens it on the run's page, reviews it, and decides — the " +
        "run stays as it is until they do. Restricted to the run's own creator — reading a run " +
        "stays open to anyone, but only who created it may propose changes to it.",
      inputSchema: z.object({
        run_id: z.string().describe("The run's UUID."),
        scenario_indices: z
          .array(z.number().int().min(0))
          .default([])
          .describe(
            "Scenarios already in the run to cover again, 0-based in scenario order. Use them to add " +
              "models or repetitions to what is already there.",
          ),
        new_scenarios: z
          .array(
            z.object({
              title: z.string(),
              system_prompt: z.string(),
              opening_message: z.string(),
              note: z.string().optional().describe("Why this scenario exists. Neither the model nor the judge sees it."),
              tools: z
                .array(z.string())
                .nullable()
                .optional()
                .describe(
                  "Tool names this scenario may call, drawn from the run's existing tools or any " +
                    "new_tools added in this same call. Omit for every tool the run defines, [] for none.",
                ),
            }),
          )
          .default([])
          .describe("Scenarios to add to the run, appended after the existing ones."),
        targets: z
          .array(z.string())
          .optional()
          .describe(
            "Models to cover — already evaluated in this run or not. Required when this call adds " +
              "anything (a non-empty scenario_indices or new_scenarios); omit for a request that only " +
              "deepens, since deepening adds no cell and never reads this.",
          ),
        repetitions: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "How many attempts to add per cell. Required, and read, only when this call adds " +
              "something; omit for a deepen-only request.",
          ),
        new_tools: z
          .array(
            z.object({
              name: z.string(),
              description: z.string(),
              result: z.string().describe("What the tool returns, always the same thing."),
              parameters: z
                .array(
                  z.object({
                    name: z.string(),
                    type: z.enum(["string", "number", "integer", "boolean"]),
                    description: z.string(),
                    required: z.boolean(),
                  }),
                )
                .default([]),
            }),
          )
          .optional()
          .describe(
            "Tools to add to the run's set. Adding is allowed; redefining an existing name is not — " +
              "cells already run would be read as having had this one. Independent of everything else " +
              "in this call: no scenario, model or turns change is needed to add a tool.",
          ),
        new_tools_for_existing: z
          .boolean()
          .optional()
          .describe(
            "Only meaningful alongside new_tools, and only for scenarios that never named their tools — " +
              "those take whatever the run defines. true: they get the new tools if they are run again. " +
              "false: their current tools are written out, so re-running them shows what they always saw. " +
              "Cells already run are unaffected either way. The human confirms this before anything is " +
              "applied.",
          ),
        turns: z
          .number()
          .int()
          .max(MAX_TURNS)
          .optional()
          .describe(
            "New depth for the run. Optional when this call only covers scenarios again or adds new " +
              "ones: the cells it adds simply play at the run's current depth. Never below its current " +
              "turns — a played conversation cannot be shortened, and a value that would lower it is " +
              "refused. Raising it alone, without deepen, only takes effect for scenarios or cells this " +
              "call adds; already-played attempts are untouched unless named in deepen. Required " +
              "alongside deepen — there would otherwise be no new depth to push attempts to.",
          ),
        deepen: z
          .union([z.literal("all"), z.array(z.number())])
          .optional()
          .describe(
            "Which already-played attempts to push to turns, chosen by the grade the judge gave them " +
              "— at the attempt level, not the cell, since a cell's attempts are not all graded alike. " +
              "Needs no targets or repetitions: deepening resumes real conversations rather than adding " +
              "cells. \"all\" for every graded attempt in the run; a list of grades for only the " +
              "attempts carrying one of those grades — see get_run_results for this run's rubric and " +
              "how many attempts carry each grade before choosing. An attempt with no grade, or that " +
              "errored, is never picked. Omit to add without deepening anything.",
          ),
      }),
    },
    async (input, ctx) => {
      const found = await runOrError(input.run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in found) return found.error;
      const { run } = found.run;

      const caller = callerEmail(ctx);
      const ownership = authorOnly(run.user_email, caller);
      if (ownership) return toolError(ownership);

      // `targets` et `repetitions` restent facultatifs côté schéma — une
      // demande qui n'approfondit que n'a besoin ni de l'un ni de l'autre —
      // mais `ExtendRequest` les veut présents : une demande qui n'ajoute
      // rien les porte donc vides, sans conséquence puisque
      // `cellsForExtension` ne les lit jamais dans ce cas.
      const request = {
        scenario_indices: input.scenario_indices,
        new_scenarios: input.new_scenarios,
        targets: input.targets ?? [],
        repetitions: input.repetitions ?? 0,
        ...(input.new_tools ? { new_tools: input.new_tools } : {}),
        ...(input.new_tools_for_existing === undefined
          ? {}
          : { new_tools_for_existing: input.new_tools_for_existing }),
        ...(input.turns === undefined ? {} : { turns: input.turns }),
        ...(input.deepen === undefined ? {} : { deepen: input.deepen }),
      };

      // Les mêmes contrôles que la route d'extension, au dépôt plutôt qu'au
      // lancement : un agent doit savoir tout de suite que sa proposition ne
      // tient pas, et un brouillon en attente doit être lançable.
      const problem = extendProblem(
        request,
        run.config.scenarios.length,
        run.config.tools ?? [],
        run.config.turns,
        run.config.models.adversary ?? null,
        run.config.rubric.map((level) => level.value),
      );
      if (problem) {
        return { content: [{ type: "text", text: problem }], isError: true };
      }

      const draftId = await createExtendDraft(
        input.run_id,
        request,
        caller,
        "mcp",
      );
      const cells =
        (input.scenario_indices.length + input.new_scenarios.length) *
        request.targets.length *
        request.repetitions;
      const parts: string[] = [];
      if (cells > 0) parts.push(`${cells} cell${cells > 1 ? "s" : ""} to add`);
      if (input.deepen !== undefined) parts.push("existing attempts to deepen");
      const summary = parts.length > 0 ? parts.join(" and ") : "nothing to add";
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      return {
        content: [
          {
            type: "text",
            text:
              `Saved as a draft extension of "${run.label ?? input.run_id}": ` +
              `${summary}. Nothing has been ` +
              `spent, and the run is unchanged until a human confirms it.\n\n` +
              `${origin}/eval/${input.run_id}?extend=${draftId}`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "set_run_tags",
    {
      title: "Add tags to a run",
      description:
        "Adds these labels to the tags a run already carries — the union, never a replacement: this " +
        "tool cannot remove a tag, and nothing a human placed is ever erased by calling it. Removing a " +
        "tag is a human gesture, done in the interface. A label that doesn't match an existing one " +
        "(case-insensitively) creates a new tag; see list_tags first to reuse rather than duplicate. " +
        "Restricted to the run's own creator — reading a run stays open to anyone, but only who " +
        "created it may tag it.",
      inputSchema: z.object({
        run_id: z.string().describe("The run's UUID."),
        tags: z.array(z.string()).describe("Labels to add — not ids."),
      }),
    },
    async ({ run_id, tags }, ctx) => {
      const result = await runOrError(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in result) return result.error;
      const runId = result.run.run.id;

      const ownership = authorOnly(result.run.run.user_email, callerEmail(ctx));
      if (ownership) return toolError(ownership);

      const created = await tagsForLabels(tags);
      await addRunTags(runId, created.map((tag) => tag.id));
      const current = await tagsOf(runId);
      return {
        content: [{ type: "text", text: JSON.stringify(current.map((tag) => tag.label), null, 2) }],
      };
    },
  );

  server.registerTool(
    "update_run_text",
    {
      title: "Write a run's notes or analysis",
      description:
        "Writes one of a run's two free-text Markdown fields — the write side of what " +
        "get_run_metadata already reads for both. Restricted to the run's own creator: reading " +
        "either field stays open to anyone, but only who created the run may write to them. This " +
        "overwrites, and there is no history to recover from: read the field's current content " +
        "before calling. An empty field is written with no other condition. A non-empty one is only " +
        "replaced when `replaces` matches what is on record, compared with leading and trailing " +
        "whitespace stripped from both — a copy that gained or lost a trailing newline still matches. " +
        "Otherwise the call is refused, and the refusal's message carries the current content: a " +
        "caller who skipped reading it first gets it from the refusal itself, merges its addition in, " +
        "and calls again with the merged text as `text` and this same content as `replaces` — without " +
        "a separate read in between.",
      inputSchema: z.object({
        run_id: z.string().describe("The run's UUID."),
        field: z
          .enum(["notes", "analysis"])
          .describe(
            "Which of the run's two Markdown fields to write — choose by what the text is *for*, " +
              "not by which name sounds closer to what you have in hand. `notes` is the preamble: " +
              "what this run set out to measure, written before or while it ran; duplicating a run " +
              "copies notes along with the rest of its configuration. `analysis` is written after " +
              "the fact, about what the results of *this* run actually show; a duplicate never " +
              "carries it, since it describes these numbers and no other run's. Just read a matrix " +
              "and want to record what it shows: analysis. Recording what a run is meant to test, " +
              "before or while it runs: notes.",
          ),
        text: z.string().describe("The Markdown to write, replacing whatever `field` currently holds."),
        replaces: z
          .string()
          .optional()
          .describe(
            "The field's current content, verbatim — from get_run_metadata's `notes` or `analysis`. " +
              "Required to overwrite a non-empty field; omit only when it is currently empty. A " +
              "mismatch refuses the write and returns the current content instead.",
          ),
      }),
    },
    async ({ run_id, field, text, replaces }, ctx) => {
      const result = await runOrError(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in result) return result.error;
      const { run } = result.run;

      const ownership = authorOnly(run.user_email, callerEmail(ctx));
      if (ownership) return toolError(ownership);

      const current = field === "notes" ? run.notes : run.analysis;
      if (!analysisReplaceAllowed(current, replaces)) {
        return toolError(
          `This run already carries a non-empty ${field}, and \`replaces\` does not match it — ` +
            `writing now would silently overwrite it. Here is the current ${field}; merge your ` +
            "change into it and call again with the full result as `text` and this text as " +
            `\`replaces\`.\n\n${current}`,
        );
      }
      if (field === "notes") {
        await saveNotes(run_id, text);
      } else {
        await saveAnalysis(run_id, text);
      }
      return { content: [{ type: "text", text: `${field === "notes" ? "Notes" : "Analysis"} saved.` }] };
    },
  );
}, {});

async function verifyToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const email = await verifyAccessToken(bearerToken);
  if (!email) return undefined;
  return { token: bearerToken, scopes: ["evals"], clientId: "evals-playground", extra: { email } };
}

const authed = withMcpAuth(handler, verifyToken, {
  required: true,
  requiredScopes: ["evals"],
  resourceMetadataPath: "/.well-known/oauth-protected-resource",
});

export { authed as GET, authed as POST };
