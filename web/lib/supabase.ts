// Accès à Supabase, côté serveur uniquement.
//
// Un client PostgREST minimal plutôt que `@supabase/supabase-js` : les routes
// ne font qu'une poignée d'opérations sur deux tables, et ce module est le
// miroir exact de `backend/playground/supabase_store.py`. Deux clients aux
// comportements subtilement différents sur la même base seraient une source de
// surprise permanente.
//
// La clé de service contourne RLS, actif sans aucune politique sur ce projet.
// Elle ne doit jamais atteindre un navigateur : rien de ce fichier ne doit être
// importé depuis un composant client.
import "server-only";

export const RUNS = "eval_runs";
export const SAMPLES = "eval_samples";
export const DRAFTS = "eval_run_drafts";
export const TAGS = "tags";
export const RUN_TAGS = "eval_run_tags";

/** Horodatage confié à la base plutôt qu'à l'horloge de la machine.
 *
 * PostgREST transmet la valeur telle quelle et PostgreSQL la reconnaît en
 * entrée d'un `timestamptz`. Toutes les horodates viennent ainsi de la même
 * horloge que `updated_at`, posé par déclencheur côté serveur — c'est cette
 * cohérence qui rend comparable l'écart sur lequel repose la détection des runs
 * abandonnés. */
export const NOW = "now()";

export class SupabaseError extends Error {}

function credentials(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new SupabaseError(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.",
    );
  }
  return { url: url.replace(/\/$/, ""), key };
}

type Params = Record<string, string | number>;

async function request(
  method: string,
  table: string,
  options: { params?: Params; body?: unknown; prefer?: string } = {},
): Promise<unknown> {
  const { url, key } = credentials();
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(options.params ?? {})) {
    query.set(name, String(value));
  }
  const suffix = query.toString() ? `?${query}` : "";

  const response = await fetch(`${url}/rest/v1/${table}${suffix}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    // Next.js remplace `fetch` par une version qui met en cache : sans ça, une
    // lecture peut renvoyer des lignes que la base ne contient plus. Le
    // `dynamic = "force-dynamic"` d'une route ne couvre pas ce cache-là — il
    // sort la *route* du rendu statique, pas le fetch en dessous. Aucune
    // lecture ici ne veut d'une réponse en cache : l'écran est censé refléter
    // la base telle qu'elle est maintenant.
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // PostgREST met dans le corps le nom de la contrainte violée ou la colonne
    // fautive, qui sont la seule chose utile pour comprendre.
    throw new SupabaseError(
      `${method} ${table} → ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  const text = await response.text();
  return text.trim() ? JSON.parse(text) : null;
}

export async function select<T = Record<string, unknown>>(
  table: string,
  params: Params = {},
): Promise<T[]> {
  return ((await request("GET", table, { params })) as T[]) ?? [];
}

export async function insert<T = Record<string, unknown>>(
  table: string,
  rows: unknown,
  options: { returning?: boolean } = {},
): Promise<T[]> {
  return (
    ((await request("POST", table, {
      body: rows,
      prefer: options.returning ? "return=representation" : "return=minimal",
    })) as T[]) ?? []
  );
}

export async function update(
  table: string,
  values: Record<string, unknown>,
  filters: Params,
): Promise<void> {
  await request("PATCH", table, { params: filters, body: values });
}

export async function remove(table: string, filters: Params): Promise<void> {
  await request("DELETE", table, { params: filters });
}

/** Supprime, et rend les lignes effacées — contrairement à `remove`, qui n'en
 *  garde pas trace. `Prefer: return=representation` fait porter par PostgREST
 *  la même distinction que `insert({ returning: true })` : sans elle, un
 *  filtre qui ne touche aucune ligne et un filtre qui en efface une se
 *  répondent tous les deux par un succès muet. Un appelant à qui cette
 *  différence importe — révoquer, par exemple — doit pouvoir la lire. */
export async function removeReturning<T = Record<string, unknown>>(
  table: string,
  filters: Params,
): Promise<T[]> {
  return (
    ((await request("DELETE", table, {
      params: filters,
      prefer: "return=representation",
    })) as T[]) ?? []
  );
}

export async function rpc<T = unknown>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  return (await request("POST", `rpc/${fn}`, { body: args })) as T;
}

let lastSweep = 0;

/** Termine les runs dont le job a disparu, avant toute lecture.
 *
 * L'appeler ici plutôt que de dépendre d'une tâche planifiée évite `pg_cron`,
 * qui n'est pas activé sur ce projet.
 *
 * Espacé de trente secondes : la page d'un run en cours interroge toutes les
 * trois secondes, et un aller-retour de plus à chaque fois allongeait la
 * réponse d'un tiers pour chercher un abandon qui, par définition, met deux
 * heures à se produire.
 *
 * Un échec n'interrompt pas la lecture qui suit : ne pas avoir pu corriger un
 * run abandonné est moins grave que de ne rien afficher du tout. */
export async function failStaleRuns(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 30_000) return;
  lastSweep = now;
  try {
    await rpc("fail_stale_eval_runs");
  } catch (error) {
    console.error("fail_stale_eval_runs:", (error as Error).message);
  }
}
