import { getPublicOrigin } from "mcp-handler";

/** The RFC 8414 metadata of this minimal authorisation server — no
 *  `registration_endpoint`: `client_id` is fixed, typed in by hand in claude.ai
 *  rather than registered dynamically. */
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
        // offline_access: without it here, Claude never asks for it and no refresh
        // token comes out of the first exchange.
      scopes_supported: ["evals", "offline_access"],
    },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
