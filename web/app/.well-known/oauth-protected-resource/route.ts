import { getPublicOrigin } from "mcp-handler";

/** Les métadonnées RFC 9728 : où se trouve le serveur d'autorisation, pour
 *  quelle adresse de serveur MCP. `resource` doit être l'adresse exacte que
 *  l'utilisateur colle dans claude.ai. */
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
