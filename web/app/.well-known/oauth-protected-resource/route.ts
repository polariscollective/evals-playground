import { getPublicOrigin } from "mcp-handler";

/** The RFC 9728 metadata: where the authorisation server is, for which MCP
 *  server address. `resource` must be the exact address the user pastes into
 *  claude.ai. */
export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  return Response.json(
    {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ["evals", "offline_access"],
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
