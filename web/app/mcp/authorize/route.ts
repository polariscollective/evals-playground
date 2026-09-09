// The consent screen of an authorisation server that verifies nobody's identity
// itself: it hands over to Google, already in place.
import { NextResponse } from "next/server";
import { getPublicOrigin } from "mcp-handler";
import { getSessionEmail } from "@/auth";
import { clientId, issueAuthCode, REDIRECT_URI } from "@/lib/mcp-auth";

function fail(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function escapeHtml(value: string): string {
  const table: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (c) => table[c]);
}

interface Params {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  state: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
}

function paramsOf(url: URL): Params {
  return {
    responseType: url.searchParams.get("response_type"),
    clientId: url.searchParams.get("client_id"),
    redirectUri: url.searchParams.get("redirect_uri"),
    state: url.searchParams.get("state"),
    codeChallenge: url.searchParams.get("code_challenge"),
    codeChallengeMethod: url.searchParams.get("code_challenge_method"),
  };
}

/** The consent screen, and the redirect to Google if a session is missing.
 *
 * The client and the return address are checked first, and with no redirect:
 * they alone cannot follow an error redirect, on pain of making this route an
 * open redirector. The other errors go back to the caller, which knows what to
 * do with them. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = paramsOf(url);

  if (params.clientId !== clientId()) return fail("Unknown client_id.");
  if (params.redirectUri !== REDIRECT_URI) return fail("Unknown redirect_uri.");

  if (
    params.responseType !== "code" ||
    !params.codeChallenge ||
    params.codeChallengeMethod !== "S256"
  ) {
    const back = new URL(params.redirectUri);
    back.searchParams.set("error", "invalid_request");
    if (params.state) back.searchParams.set("state", params.state);
    return NextResponse.redirect(back);
  }

  const email = await getSessionEmail();
  if (!email) {
      // Not `url.origin`: behind Vercel's proxy, `request.url` carries the
      // internal host, and the `callbackUrl` would then designate an origin
      // NextAuth judges foreign and rewrites to `/`. The user would sign in to
      // Google only to land on the home page, while claude.ai waited for a code
      // that would never arrive. Same reason as `originOf` in `/format.txt`.
    const origin = getPublicOrigin(request);
    const signin = new URL("/signin", origin);
    signin.searchParams.set("callbackUrl", `${origin}${url.pathname}${url.search}`);
    return NextResponse.redirect(signin);
  }

  const hidden = [
    ["client_id", params.clientId],
    ["redirect_uri", params.redirectUri],
    ["state", params.state ?? ""],
    ["code_challenge", params.codeChallenge],
  ]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${name}" value="${escapeHtml(value ?? "")}">`,
    )
    .join("\n");

  return new Response(
    `<!doctype html>
<html>
<body style="font-family: system-ui; max-width: 32rem; margin: 4rem auto;">
  <h1>Connect evals-playground</h1>
  <p>Sign in as <strong>${escapeHtml(email)}</strong> to this MCP connector?</p>
  <form method="POST">
    ${hidden}
    <button type="submit">Allow</button>
  </form>
</body>
</html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** The "Allow" click: mints the code, redirects to `redirect_uri`. */
export async function POST(request: Request) {
  const form = await request.formData();
  const receivedClientId = String(form.get("client_id") ?? "");
  const redirectUri = String(form.get("redirect_uri") ?? "");
  const state = String(form.get("state") ?? "");
  const codeChallenge = String(form.get("code_challenge") ?? "");

  if (receivedClientId !== clientId() || redirectUri !== REDIRECT_URI) {
    return fail("Unknown client_id or redirect_uri.");
  }

  const email = await getSessionEmail();
  if (!email) return fail("Not signed in.");

  const code = await issueAuthCode({ userEmail: email, redirectUri, codeChallenge });

  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  if (state) back.searchParams.set("state", state);
  // 303, and above all not the 307 `NextResponse.redirect` lays down by default:
  // a 307 preserves the method, so that the browser replayed this redirect as a
  // POST on claude.ai's return address, which answers "Method Not Allowed" — an
  // OAuth authorisation response is delivered by GET.
  return NextResponse.redirect(back, 303);
}
