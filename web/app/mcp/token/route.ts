import { NextResponse } from "next/server";
import { pkceMatches } from "@/lib/mcp-crypto";
import { clientId, consumeAuthCode, issueTokenPair, rotateRefreshToken } from "@/lib/mcp-auth";

function oauthError(status: number, error: string, description?: string): Response {
  return NextResponse.json(
    { error, ...(description ? { error_description: description } : {}) },
    { status },
  );
}

function tokenResponse(pair: {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}) {
  return NextResponse.json(
    {
      access_token: pair.accessToken,
      token_type: "Bearer",
      expires_in: pair.expiresIn,
      refresh_token: pair.refreshToken,
      // `offline_access` avec `evals`, et pas `evals` seul : un jeton de
      // rafraîchissement est toujours émis, et rendre une portée plus étroite
      // que celle demandée dit au client qu'il ne l'a pas obtenue (RFC 6749
      // §5.1). Il en conclurait n'avoir aucun rafraîchissement, et la connexion
      // mourrait en silence au bout d'une heure.
      scope: "evals offline_access",
    },
    // RFC 6749 §5.1 : une réponse de jeton porte toujours cet en-tête. Rien ne
    // met en cache cette route aujourd'hui — elle est dynamique — donc ce
    // n'est encore qu'une question de conformité, pas un bug vécu.
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** L'échange de code, et le rafraîchissement — les deux à la même adresse,
 *  distingués par `grant_type`, en `application/x-www-form-urlencoded` comme
 *  l'exige la RFC 6749 §4.1.3. `request.formData()` le lit nativement, ce
 *  format et `multipart/form-data` tous les deux. */
export async function POST(request: Request) {
  const form = await request.formData();
  const grantType = form.get("grant_type");
  // Le seul indice sur qui appelle : l'échange se fait de serveur à serveur,
  // sans session ni navigateur. Gardé tel quel sur le grant, il permet de
  // distinguer claude.ai d'un client qui ferait son propre OAuth en local.
  const userAgent = request.headers.get("user-agent");

  if (grantType === "authorization_code") {
    const code = String(form.get("code") ?? "");
    const receivedClientId = String(form.get("client_id") ?? "");
    const redirectUri = String(form.get("redirect_uri") ?? "");
    const verifier = String(form.get("code_verifier") ?? "");

    if (receivedClientId !== clientId()) return oauthError(400, "invalid_client");

    const consumed = await consumeAuthCode(code);
    if (!consumed) return oauthError(400, "invalid_grant", "unknown or expired code");
    if (consumed.redirect_uri !== redirectUri) {
      return oauthError(400, "invalid_grant", "redirect_uri does not match");
    }
    if (!pkceMatches(verifier, consumed.code_challenge)) {
      return oauthError(400, "invalid_grant", "code_verifier does not match");
    }

    return tokenResponse(
      await issueTokenPair(consumed.user_email, { born: "authorization_code", userAgent }),
    );
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    const pair = await rotateRefreshToken(refreshToken, userAgent);
    if (!pair) return oauthError(400, "invalid_grant", "unknown or expired refresh token");
    return tokenResponse(pair);
  }

  return oauthError(400, "unsupported_grant_type");
}
