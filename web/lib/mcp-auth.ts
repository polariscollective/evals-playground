// The identity of an MCP caller. No dynamically registered client: the
// connector is personal, its client_id is fixed — MCP_CLIENT_ID — typed by hand
// into claude.ai rather than obtained by dynamic registration.
//
// `/mcp/authorize` does not talk to Google again: it sends you back to the
// sign-in screen already in place, one single way of checking who you are, like
// `isAllowedEmail`.
import "server-only";
import { newToken, hashOf } from "./mcp-crypto";
import { clientLabelOf, needsTouch } from "./mcp-grants";
import { NOW, insert, remove, removeReturning, rpc, select, update } from "./supabase";

export const AUTH_CODES = "mcp_auth_codes";
export const TOKENS = "mcp_tokens";

const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** The one return address accepted: that of the hosted Claude surfaces — web,
 *  Desktop, mobile, Cowork. Documented by Anthropic, it does not vary from one
 *  deployment to the next. */
export const REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";

export function clientId(): string {
  const id = process.env.MCP_CLIENT_ID;
  if (!id) throw new Error("MCP_CLIENT_ID must be set.");
  return id;
}

function future(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

export async function issueAuthCode(params: {
  userEmail: string;
  redirectUri: string;
  codeChallenge: string;
}): Promise<string> {
  const code = newToken();
  await insert(AUTH_CODES, {
    code_hash: hashOf(code),
    user_email: params.userEmail,
    redirect_uri: params.redirectUri,
    code_challenge: params.codeChallenge,
    expires_at: future(AUTH_CODE_TTL_MS),
  });
  return code;
}

export interface ConsumedCode {
  user_email: string;
  redirect_uri: string;
  code_challenge: string;
}

/** Lit un code puis le supprime, pour qu'il ne serve qu'une fois. `null`
 *  if it is unknown, already consumed, or expired. */
export async function consumeAuthCode(code: string): Promise<ConsumedCode | null> {
  const hash = hashOf(code);
  const rows = await select<ConsumedCode & { expires_at: string }>(AUTH_CODES, {
    code_hash: `eq.${hash}`,
    select: "user_email,redirect_uri,code_challenge,expires_at",
    limit: 1,
  });
  const row = rows[0];
  if (!row) return null;
  await remove(AUTH_CODES, { code_hash: `eq.${hash}` });
  if (isPast(row.expires_at)) return null;
  return row;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Where a pair of tokens comes from.
 *
 * A rotation erases its row and lays down a fresh one: a row left as
 * `authorization_code` is therefore a chain that has never been refreshed even
 * once. That is what makes it readable, on the connections screen, whether a
 * client really refreshes or goes round the whole loop every time. */
export type GrantOrigin = "authorization_code" | "refresh_token";

export async function issueTokenPair(
  userEmail: string,
  provenance: { born: GrantOrigin; userAgent?: string | null },
): Promise<TokenPair> {
  const accessToken = newToken();
  const refreshToken = newToken();
  await insert(TOKENS, {
    access_token_hash: hashOf(accessToken),
    refresh_token_hash: hashOf(refreshToken),
    user_email: userEmail,
    access_expires_at: future(ACCESS_TOKEN_TTL_MS),
    refresh_expires_at: future(REFRESH_TOKEN_TTL_MS),
    born: provenance.born,
    client_label: clientLabelOf(provenance.userAgent),
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_MS / 1000 };
}

/** The email behind an access token, or `null` if it is unknown or expired.
 *
 * Marque au passage la connexion comme vivante — au plus une fois par
 * interval, and never to the point of failing the call: a timestamp of
 * convenience must not cost the tool that was being served. */
export async function verifyAccessToken(token: string): Promise<string | null> {
  const hash = hashOf(token);
  const rows = await select<{
    user_email: string;
    access_expires_at: string;
    last_used_at: string | null;
  }>(TOKENS, {
    access_token_hash: `eq.${hash}`,
    select: "user_email,access_expires_at,last_used_at",
    limit: 1,
  });
  const row = rows[0];
  if (!row || isPast(row.access_expires_at)) return null;
  if (needsTouch(row.last_used_at)) {
    try {
      await update(TOKENS, { last_used_at: NOW }, { access_token_hash: `eq.${hash}` });
    } catch (error) {
      console.error("last_used_at:", (error as Error).message);
    }
  }
  return row.user_email;
}

/** Rotation: the old pair dies, a new one is born for the same email. `null`
 *  if the refresh token is unknown or expired — never "
 *  presque » : Claude retente sur un `invalid_grant` net. */
export async function rotateRefreshToken(
  refreshToken: string,
  userAgent?: string | null,
): Promise<TokenPair | null> {
  const hash = hashOf(refreshToken);
  const rows = await select<{ user_email: string; refresh_expires_at: string }>(
    TOKENS,
    { refresh_token_hash: `eq.${hash}`, select: "user_email,refresh_expires_at", limit: 1 },
  );
  const row = rows[0];
  if (!row || isPast(row.refresh_expires_at)) return null;
  await remove(TOKENS, { refresh_token_hash: `eq.${hash}` });
  return issueTokenPair(row.user_email, { born: "refresh_token", userAgent });
}

export interface Grant {
  access_token_hash: string;
  user_email: string;
  created_at: string;
  refresh_expires_at: string;
  last_used_at: string | null;
  client_label: string | null;
  born: GrantOrigin;
}

let lastSweep = 0;

/** Erases stale codes and forgotten connections before any read — even
 *  patron que `sweepStaleDrafts`, avec un intervalle large : rien de ce que ce
 *  broom sweeps up is urgent, since every read already checks its own expiry.
 *  It is there only so the screen does not end up a graveyard. */
async function sweepExpiredGrants(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  try {
    await rpc("sweep_expired_mcp_grants");
  } catch (error) {
    console.error("sweep_expired_mcp_grants:", (error as Error).message);
  }
}

/** An email's active connections, for the screen that allows revoking them.
 *
 * Filtered on the session's email, never on anything else: you see only your
 * own, and this screen teaches you of nobody else's existence. */
export async function listGrants(userEmail: string): Promise<Grant[]> {
  await sweepExpiredGrants();
  return select<Grant>(TOKENS, {
    user_email: `eq.${userEmail}`,
    select:
      "access_token_hash,user_email,created_at,refresh_expires_at,last_used_at,client_label,born",
    order: "created_at.desc",
  });
}

/** Revokes a connection: its owner must match, without which any signed-in
 *  email could cut somebody else's.
 *
 *  Returns `true` when a row has really gone. It is the only way to know: an
 *  access token rotates at every refresh
 *  (`rotateRefreshToken` efface la ligne et en pose une neuve), si bien que
 *  the fingerprint the screen holds may name a row already gone — and that
 *  revocation must not pass itself off as a success. */
export async function revokeGrant(
  accessTokenHash: string,
  userEmail: string,
): Promise<boolean> {
  const removed = await removeReturning(TOKENS, {
    access_token_hash: `eq.${accessTokenHash}`,
    user_email: `eq.${userEmail}`,
  });
  return removed.length > 0;
}

/** Cut everything at once, and return how many fell.
 *
 * The gesture that was missing: one row revoked at random does not say which of
 * the other nine still opened the door. Bounded to the same email as the rest —
 * that is the filter, not a check made after the fact. */
export async function revokeAllGrants(userEmail: string): Promise<number> {
  const removed = await removeReturning(TOKENS, { user_email: `eq.${userEmail}` });
  return removed.length;
}
