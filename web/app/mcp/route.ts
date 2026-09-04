// Le serveur MCP. Un outil pour l'instant : read_prompt, qui ne fait que
// rejouer /prompt — la preuve que la chaîne OAuth marche de bout en bout
// avant d'y ajouter ce qui touche vraiment aux runs.
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { z } from "zod";
import { agentModels, agentPrompt } from "@/lib/agent-prompt";
import { verifyAccessToken } from "@/lib/mcp-auth";

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
