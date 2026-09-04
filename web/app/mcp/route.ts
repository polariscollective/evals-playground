// Le serveur MCP : lire les runs, en reprendre la configuration, et en
// déposer un sans le lancer.
//
// Aucun outil ne démarre quoi que ce soit — submit_draft_run valide, chiffre et
// pose un brouillon, le lancement reste un clic humain. Les descriptions le
// disent en premier plutôt qu'en dernier : un agent qui croit risquer de
// dépenser l'argent de quelqu'un n'appelle pas l'outil, et se rabat sur ce
// qu'il imagine plus doux.
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentModels, mcpAgentPrompt } from "@/lib/agent-prompt";
import { readConfigFile, writeConfigFile } from "@/lib/config-file";
import {
  DraftNotFound,
  createDraft,
  createExtendDraft,
  loadDraft,
  updateDraft,
} from "@/lib/drafts";
import { verifyAccessToken } from "@/lib/mcp-auth";
import { cellsOf, overallMean } from "@/lib/matrix";
import { costSentence } from "@/lib/pricing";
import { NotFound, loadRun, loadRuns, loadSampleTranscript } from "@/lib/runs";
import { isRunId } from "@/lib/run-id";
import { countMatches, searchRuns } from "@/lib/run-search";
import { addRunTags, loadTags, setDraftTags, tagsByRun, tagsForLabels, tagsOf } from "@/lib/tags";
import { extendProblem } from "@/lib/validate";
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
      title: "Rewrite a draft in place",
      description:
        "Nothing is launched and nothing is spent by calling this, exactly like submit_draft_run: it " +
        "checks the document first, and only then replaces the draft's contents. Use it to correct a " +
        "draft rather than leave two of them side by side, when the person cannot tell which is the " +
        "good one. Three refusals, all before anything is written: a draft created by someone else — " +
        "only its own author may rewrite it; a draft that has already been launched — it produced a " +
        "run, and rewriting it would falsify where that run came from, so submit a new one; and a " +
        "document that would be refused anyway, with the reason. Note that a draft whose scenarios " +
        "came from an uploaded CSV keeps the scenarios you send but loses the file itself.",
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

      // L'auteur d'abord, avant même de regarder le document : refuser pour la
      // bonne raison compte plus que refuser vite.
      const caller = callerEmail(ctx);
      if (draft.created_by !== caller) {
        return toolError(
          `This draft was created by ${draft.created_by}, and you are calling as ${caller}. ` +
            "Only its author can rewrite it — submit a new draft instead.",
        );
      }
      if (draft.launched_at) {
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
      // `csv_text` part avec l'ancienne configuration : les scénarios reçus ici
      // sont écrits en clair, plus rien ne renvoie au fichier téléversé, et le
      // garder attaché ferait croire à une source qui n'en est plus une.
      await updateDraft(draft_id, config, null, "mcp");
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
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
    "extend_run",
    {
      title: "Propose adding to an existing run",
      description:
        "Nothing is launched and nothing is spent by calling this. It proposes adding a sub-matrix to a " +
        "run that already exists — more models, more repetitions, more scenarios — and saves that " +
        "proposal as a draft. A human opens it on the run's page, reviews it and decides. The run is " +
        "not touched until they do. What cannot be changed by extending: the judge, the scale, the " +
        "criterion and the number of turns — a second batch judged differently would not be comparable " +
        "to the first, and a matrix exists to be compared.",
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
                  "Tool names this scenario may call. Omit for every tool the run defines, [] for none.",
                ),
            }),
          )
          .default([])
          .describe("Scenarios to add to the run, appended after the existing ones."),
        targets: z
          .array(z.string())
          .describe("Models to cover — already evaluated in this run or not."),
        repetitions: z.number().int().min(1).describe("How many attempts to add per cell."),
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
              "cells already run would be read as having had this one.",
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
      }),
    },
    async (input, ctx) => {
      const found = await runOrError(input.run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in found) return found.error;
      const { run } = found.run;

      const request = {
        scenario_indices: input.scenario_indices,
        new_scenarios: input.new_scenarios,
        targets: input.targets,
        repetitions: input.repetitions,
        ...(input.new_tools ? { new_tools: input.new_tools } : {}),
        ...(input.new_tools_for_existing === undefined
          ? {}
          : { new_tools_for_existing: input.new_tools_for_existing }),
      };

      // Les mêmes contrôles que la route d'extension, au dépôt plutôt qu'au
      // lancement : un agent doit savoir tout de suite que sa proposition ne
      // tient pas, et un brouillon en attente doit être lançable.
      const problem = extendProblem(
        request,
        run.config.scenarios.length,
        run.config.tools ?? [],
      );
      if (problem) {
        return { content: [{ type: "text", text: problem }], isError: true };
      }

      const draftId = await createExtendDraft(
        input.run_id,
        request,
        callerEmail(ctx),
        "mcp",
      );
      const cells =
        (input.scenario_indices.length + input.new_scenarios.length) *
        input.targets.length *
        input.repetitions;
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      return {
        content: [
          {
            type: "text",
            text:
              `Saved as a draft extension of "${run.label ?? input.run_id}": ` +
              `${cells} cell${cells > 1 ? "s" : ""} to add. Nothing has been ` +
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
        "(case-insensitively) creates a new tag; see list_tags first to reuse rather than duplicate.",
      inputSchema: z.object({
        run_id: z.string().describe("The run's UUID."),
        tags: z.array(z.string()).describe("Labels to add — not ids."),
      }),
    },
    async ({ run_id, tags }) => {
      const result = await runOrError(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in result) return result.error;
      const created = await tagsForLabels(tags);
      const runId = result.run.run.id;
      await addRunTags(runId, created.map((tag) => tag.id));
      const current = await tagsOf(runId);
      return {
        content: [{ type: "text", text: JSON.stringify(current.map((tag) => tag.label), null, 2) }],
      };
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
