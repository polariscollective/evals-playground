// L'identité d'un appelant MCP. Pas de client enregistré dynamiquement : le
// connecteur est personnel, son client_id est fixe — MCP_CLIENT_ID — saisi à
// la main dans claude.ai plutôt qu'obtenu par enregistrement dynamique.
//
// `/mcp/authorize` ne reparle pas à Google : il renvoie vers l'écran de
// connexion déjà en place, une seule façon de vérifier qui on est, comme
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

/** L'unique adresse de retour acceptée : celle des surfaces Claude hébergées
 *  — web, Desktop, mobile, Cowork. Documentée par Anthropic, elle ne varie
 *  pas d'un déploiement à l'autre. */
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
 *  s'il est inconnu, déjà consommé, ou expiré. */
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

/** D'où vient un couple de jetons.
 *
 * Une rotation efface sa ligne et en pose une neuve : une ligne restée
 * `authorization_code` est donc une chaîne qui n'a jamais été rafraîchie une
 * seule fois. C'est ce qui permet de lire, sur l'écran des connexions, si un
 * client rafraîchit vraiment ou s'il refait le tour complet à chaque fois. */
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

/** L'email derrière un jeton d'accès, ou `null` s'il est inconnu ou expiré.
 *
 * Marque au passage la connexion comme vivante — au plus une fois par
 * intervalle, et jamais au point de faire échouer l'appel : une horodate de
 * confort ne doit pas coûter l'outil qu'on était en train de rendre. */
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

/** Rotation : l'ancien couple meurt, un nouveau naît pour le même email.
 *  `null` si le jeton de rafraîchissement est inconnu ou expiré — jamais «
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

/** Efface codes périmés et connexions oubliées avant toute lecture — même
 *  patron que `sweepStaleDrafts`, avec un intervalle large : rien de ce que ce
 *  balai ramasse n'est urgent, puisque toute lecture vérifie déjà sa propre
 *  échéance. Il n'est là que pour que l'écran ne finisse pas en cimetière. */
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

/** Les connexions actives d'un email, pour l'écran qui permet de les révoquer.
 *
 * Filtrées sur l'email de la session, jamais sur autre chose : on ne voit que
 * les siennes, et cet écran n'apprend l'existence de personne d'autre. */
export async function listGrants(userEmail: string): Promise<Grant[]> {
  await sweepExpiredGrants();
  return select<Grant>(TOKENS, {
    user_email: `eq.${userEmail}`,
    select:
      "access_token_hash,user_email,created_at,refresh_expires_at,last_used_at,client_label,born",
    order: "created_at.desc",
  });
}

/** Révoque une connexion : son propriétaire doit correspondre, sans quoi
 *  n'importe quel email connecté pourrait couper celle d'un autre.
 *
 *  Rend `true` quand une ligne a vraiment disparu. C'est la seule façon de
 *  savoir : un jeton d'accès tourne à chaque rafraîchissement
 *  (`rotateRefreshToken` efface la ligne et en pose une neuve), si bien que
 *  l'empreinte que tient l'écran peut désigner une ligne déjà partie — et
 *  cette révocation-là ne doit pas se faire passer pour une réussite. */
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

/** Tout couper d'un coup, et rendre combien sont tombées.
 *
 * Le geste qui manquait : une ligne révoquée au hasard n'apprend pas laquelle
 * des neuf autres ouvrait encore la porte. Borné au même email que le reste —
 * c'est le filtre, pas une vérification faite après coup. */
export async function revokeAllGrants(userEmail: string): Promise<number> {
  const removed = await removeReturning(TOKENS, { user_email: `eq.${userEmail}` });
  return removed.length;
}
