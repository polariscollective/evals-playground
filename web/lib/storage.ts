// Les journaux d'Inspect, lus dans Supabase Storage.
//
// Miroir de `backend/playground/log_store.py`, qui les y monte : un dossier par
// run, one `.eval` per pass, plus the `listing.json` manifest inspect writes.
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

/** Les journaux d'un run, ou une liste vide s'il n'en a pas.
 *
 * A run launched before this directory existed, or a job that died before
 * inspect wrote, has none — that is a normal state, not an error, and it is
 * what decides whether the button shows. A Storage failure gives the same
 * silence : mieux vaut un bouton absent qu'une page de run en erreur. */
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

/** Un objet du dossier d'un run, tel que Storage le rend.
 *
 * The response is relayed without being read: the viewer asks for slices of a
 * ZIP by `Range`, and reading them here to recompose them would cost the memory
 * du serveur sur des fichiers qu'il n'a aucune raison d'ouvrir.
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
