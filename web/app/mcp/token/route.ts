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
        // `offline_access` with `evals`, and not `evals` alone: a refresh token is
        // always issued, and returning a scope narrower than the one asked for
        // tells the client it did not get it (RFC 6749 §5.1). It would conclude it
        // had no refresh, and the connection would die in silence after an hour.
      scope: "evals offline_access",
    },
    // RFC 6749 §5.1: a token response always carries this header. Nothing caches
    // this route today — it is dynamic — so it is still only a matter of
    // conformance, not a bug lived through.
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** The code exchange, and the refresh — both at the same address, told apart by
 *  `grant_type`, in `application/x-www-form-urlencoded` as RFC 6749 §4.1.3
 *  demands. `request.formData()` reads it natively, that format and
 *  `multipart/form-data` both. */
export async function POST(request: Request) {
  const form = await request.formData();
  const grantType = form.get("grant_type");
  // The only clue about who is calling: the exchange happens server to server,
  // with no session and no browser. Kept as it stands on the grant, it allows
  // telling claude.ai apart from a client doing its own OAuth locally.
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
