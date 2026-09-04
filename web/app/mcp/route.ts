// Le serveur MCP : lire les runs, et en déposer un sans le lancer.
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
import { readConfigFile } from "@/lib/config-file";
import { createDraft } from "@/lib/drafts";
import { verifyAccessToken } from "@/lib/mcp-auth";
import { cellsOf, overallMean } from "@/lib/matrix";
import { costSentence } from "@/lib/pricing";
import { NotFound, loadRun, loadRuns, loadSampleTranscript } from "@/lib/runs";
import { isRunId } from "@/lib/run-id";
import { countMatches, searchRuns } from "@/lib/run-search";
import { tagsByRun } from "@/lib/tags";
import { verdictOf } from "@/lib/verdict";
import type { RunDetail } from "@/lib/types";

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
        "The matrix: mean grade per scenario × model, judged/errored/pending counts and cost — no transcripts.",
      inputSchema: z.object({ run_id: z.string().describe("The run's UUID.") }),
    },
    async ({ run_id }) => {
      const result = await runOrError(run_id, { withTranscripts: false, withSourceCsvFlag: false });
      if ("error" in result) return result.error;
      const { run, samples } = result.run;
      const cells = cellsOf(samples, run.config.scenarios.length, run.config.rubric);
      const results = {
        overall_mean: overallMean(samples, run.config.rubric),
        scenarios: run.config.scenarios.map((scenario, index) => ({
          title: scenario.title,
          by_model: run.config.models.targets.map((model) => {
            const cell = cells[index]?.[model];
            return {
              model,
              mean: cell?.mean ?? null,
              judged: cell?.judged ?? 0,
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
      }),
    },
    async ({ yaml }, ctx) => {
      const verdict = verdictOf(yaml, costSentence);
      if (verdict.status !== 200 || verdict.message.startsWith("INCOMPLETE")) {
        // INCOMPLETE annonce un CSV que ce canal ne sait pas porter — un
        // agent écrit les scénarios en clair, comme le prompt le demande.
        return { content: [{ type: "text", text: verdict.message }], isError: true };
      }
      const { config } = readConfigFile(yaml);
      const draftId = await createDraft(config, null, callerEmail(ctx), "mcp");
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      return {
        content: [{ type: "text", text: `${verdict.message}\n\n${origin}/runs/drafts/${draftId}` }],
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
