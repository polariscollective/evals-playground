// Le serveur MCP. Un outil pour l'instant : read_prompt, qui ne fait que
// rejouer /prompt — la preuve que la chaîne OAuth marche de bout en bout
// avant d'y ajouter ce qui touche vraiment aux runs.
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentModels, agentPrompt } from "@/lib/agent-prompt";
import { verifyAccessToken } from "@/lib/mcp-auth";
import { NotFound, loadRun } from "@/lib/runs";
import { cellsOf, overallMean } from "@/lib/matrix";
import { isRunId } from "@/lib/run-id";
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

const handler = createMcpHandler((server) => {
  server.registerTool(
    "read_prompt",
    {
      title: "Read the run-writing prompt",
      description:
        "The instructions for writing an evals-playground run as YAML — the same document served at /prompt.",
      inputSchema: z.object({}),
    },
    async (_args, ctx) => {
      // `ctx.http.req` : la requête d'origine, vérifiée dans
      // @modelcontextprotocol/server. `agentPrompt` accepte une origine vide
      // — elle écrit alors /validate en relatif, ce qu'un agent qui vient de
      // lire cette page résout de lui-même.
      const origin = ctx.http?.req ? getPublicOrigin(ctx.http.req) : "";
      return { content: [{ type: "text", text: agentPrompt(agentModels(), origin) }] };
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
