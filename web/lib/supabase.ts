// Access to Supabase, server side only.
//
// A minimal PostgREST client rather than `@supabase/supabase-js`: the routes
// perform only a handful of operations on two tables, and this module is the
// exact mirror of `backend/playground/supabase_store.py`. Two clients behaving
// subtly differently against the same database would be a permanent source of
// surprise.
//
// The service key bypasses RLS, which is on with no policy at all on this
// project. It must never reach a browser: nothing in this file may be imported
// from a client component.
import "server-only";

export const RUNS = "eval_runs";
export const SAMPLES = "eval_samples";
/** The list's aggregation view: one row per run, whatever the number of
 *  cells. See the migration `20260907140037_eval_run_list_view.sql`
 *  (polaris-supabase repository). */
export const RUN_LIST = "eval_run_list";
export const DRAFTS = "eval_run_drafts";
export const TAGS = "tags";
export const RUN_TAGS = "eval_run_tags";
export const DRAFT_TAGS = "eval_run_draft_tags";
// One row per launch that succeeded through MCP, `run` as much as `extend` —
// see `mcpSpendLastHour` and `recordLaunch` in `runs.ts`. Migrated and pushed
// in `polaris-supabase`, never here.
export const MCP_LAUNCHES = "mcp_launches";
// One row per person, their two spending caps per agent — see `ensureProfile`
// in `profiles.ts`. Migrated and pushed in `polaris-supabase`, never here.
export const PROFILES = "profiles";
// The three tables of the multiple judges — see `Judge`, `RunJudge` and
// `JudgeScore` in `types.ts`, and the migration
// `evals/supabase/migrations/20260906092100_create_judges_tables.sql`.
// Migrated and pushed in `polaris-supabase`, never here.
export const JUDGES = "judges";
export const RUN_JUDGES = "run_judges";
export const JUDGE_SCORES = "judge_scores";
export const TOOL_RESULTS = "tool_results";

/** A timestamp entrusted to the database rather than to the machine's clock.
 *
 * PostgREST passes the value through as it stands and PostgreSQL recognises it
 * as input to a `timestamptz`. Every timestamp therefore comes from the same
 * clock as `updated_at`, laid down by a server-side trigger — and it is that
 * consistency which makes comparable the gap on which the detection of
 * abandoned runs rests. */
export const NOW = "now()";

export class SupabaseError extends Error {}

/** The URL and the service key, shared with `storage.ts`: Storage and
 *  PostgREST are two services of the same database, behind the same key. */
export function credentials(): { url: string; key: string } {
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
    // Next.js replaces `fetch` with a version that caches: without this, a
    // read can return rows the database no longer holds. A route's
    // `dynamic = "force-dynamic"` does not cover that cache — it takes the
    // *route* out of static rendering, not the fetch underneath. No read here
    // wants a cached response: the screen is meant to reflect the database as
    // it stands now.
    cache: "no-store",
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    // PostgREST puts in the body the name of the violated constraint or the
    // offending column, which are the only useful thing to understand it.
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

/** Deletes, and returns the erased rows — unlike `remove`, which keeps no
 *  trace of them. `Prefer: return=representation` makes PostgREST carry the
 *  same distinction as `insert({ returning: true })`: without it, a filter that
 *  touches no row and a filter that erases one both answer with a silent
 *  success. A caller to whom that difference matters — revoking, for example —
 *  must be able to read it. */
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

/** Ends the runs whose job has vanished, before any read.
 *
 * Calling it here rather than depending on a scheduled task avoids `pg_cron`,
 * which is not enabled on this project.
 *
 * Spaced thirty seconds apart: the page of a running run polls every three
 * seconds, and one more round trip each time was lengthening the response by a
 * third to look for an abandonment which, by definition, takes two hours to
 * happen.
 *
 * A failure does not interrupt the read that follows: not having been able to
 * fix an abandoned run matters less than showing nothing at all. */
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
