import { getPublicOrigin } from "mcp-handler";

/** Les métadonnées RFC 8414 de ce serveur d'autorisation minimal — pas de
 *  `registration_endpoint` : `client_id` est fixe, saisi à la main dans
 *  claude.ai plutôt qu'enregistré dynamiquement. */
export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/mcp/authorize`,
      token_endpoint: `${origin}/mcp/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      // offline_access : sans lui ici, Claude ne le demande jamais et aucun
      // jeton de rafraîchissement ne sort du premier échange.
      scopes_supported: ["evals", "offline_access"],
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
