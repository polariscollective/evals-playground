// L'écran de consentement d'un serveur d'autorisation qui ne vérifie
// l'identité de personne lui-même : il renvoie vers Google, déjà en place.
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

/** L'écran de consentement, et le renvoi vers Google s'il manque une
 *  session.
 *
 * Le client et l'adresse de retour sont vérifiés en premier, et sans
 * redirection : eux seuls ne peuvent pas suivre un renvoi d'erreur, sous
 * peine de faire de cette route un redirecteur ouvert. Les autres erreurs
 * reviennent chez l'appelant, qui sait quoi en faire. */
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
    // Pas `url.origin` : derrière le proxy de Vercel, `request.url` porte
    // l'hôte interne, et le `callbackUrl` désignerait alors une origine que
    // NextAuth juge étrangère et réécrit en `/`. L'utilisateur se connecterait
    // à Google pour atterrir sur l'accueil, pendant que claude.ai attend un
    // code qui n'arriverait jamais. Même raison que `originOf` dans `/prompt`.
    const origin = getPublicOrigin(request);
    const signin = new URL("/api/auth/signin", origin);
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

/** Le clic « Allow » : mine le code, renvoie vers `redirect_uri`. */
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
  // 303, et surtout pas le 307 que `NextResponse.redirect` pose par défaut :
  // un 307 conserve la méthode, si bien que le navigateur rejouait ce renvoi
  // en POST sur l'adresse de retour de claude.ai, qui répond « Method Not
  // Allowed » — une réponse d'autorisation OAuth se livre en GET.
  return NextResponse.redirect(back, 303);
}
