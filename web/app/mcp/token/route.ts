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
  return NextResponse.json({
    access_token: pair.accessToken,
    token_type: "Bearer",
    expires_in: pair.expiresIn,
    refresh_token: pair.refreshToken,
    scope: "evals",
  });
}

/** L'échange de code, et le rafraîchissement — les deux à la même adresse,
 *  distingués par `grant_type`, en `application/x-www-form-urlencoded` comme
 *  l'exige la RFC 6749 §4.1.3. `request.formData()` le lit nativement, ce
 *  format et `multipart/form-data` tous les deux. */
export async function POST(request: Request) {
  const form = await request.formData();
  const grantType = form.get("grant_type");

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

    return tokenResponse(await issueTokenPair(consumed.user_email));
  }

  if (grantType === "refresh_token") {
    const refreshToken = String(form.get("refresh_token") ?? "");
    const pair = await rotateRefreshToken(refreshToken);
    if (!pair) return oauthError(400, "invalid_grant", "unknown or expired refresh token");
    return tokenResponse(pair);
  }

  return oauthError(400, "unsupported_grant_type");
}
