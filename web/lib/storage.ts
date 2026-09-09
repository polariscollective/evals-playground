// Inspect's logs, read from Supabase Storage.
//
// A mirror of `backend/playground/log_store.py`, which puts them there: one
// folder per run, one `.eval` per pass, plus the `listing.json` manifest inspect
// writes.
//
// The bucket is private. That is half the access control — public, its URL
// would be enough to bypass `is_public` — and the other half is the route,
// which checks who is looking before calling this module. Nothing here may be
// imported from a client component: the service key bypasses RLS.
import "server-only";
import { credentials } from "./supabase";
import { bareLogName, isSafeLogName } from "./inspect-view";

export const BUCKET = "inspect-logs";

export class StorageError extends Error {}

export type LogObject = {
  name: string;
  size: number | null;
  updatedAt: string | null;
};

/** A run's logs, or an empty list if it has none.
 *
 * A run launched before this directory existed, or a job that died before
 * inspect wrote, has none — that is a normal state, not an error, and it is
 * what decides whether the button shows. A Storage failure gives the same
 * silence: an absent button beats a run page in error. */
export async function listRunLogs(runId: string): Promise<LogObject[]> {
  const { url, key } = credentials();
  let rows: Array<Record<string, unknown>>;
  try {
    const response = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: runId, limit: 200 }),
      cache: "no-store",
    });
    if (!response.ok) return [];
    rows = (await response.json()) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }

  return rows
    .map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        name: bareLogName(String(row.name ?? ""), runId),
        size: typeof metadata.size === "number" ? metadata.size : null,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      };
    })
    .filter((object) => isSafeLogName(object.name));
}

/** An object from a run's folder, as Storage returns it.
 *
 * The response is relayed without being read: the viewer asks for slices of a
 * ZIP by `Range`, and reading them here to recompose them would cost the
 * server's memory on files it has no reason to open.
 *
 * The name is validated before being pasted into the URL: without that, a `..`
 * would escape the run's prefix and give another's log — an unpublished one
 * included.
 */
export async function fetchRunLog(
  runId: string,
  name: string,
  range?: string | null,
): Promise<Response> {
  if (!isSafeLogName(name)) throw new StorageError(`Bad log name: ${name}`);
  const { url, key } = credentials();
  return fetch(`${url}/storage/v1/object/${BUCKET}/${runId}/${name}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(range ? { Range: range } : {}),
    },
    cache: "no-store",
  });
}
