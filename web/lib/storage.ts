// Les journaux d'Inspect, lus dans Supabase Storage.
//
// Miroir de `backend/playground/log_store.py`, qui les y monte : un dossier par
// run, un `.eval` par passe, plus le manifeste `listing.json` qu'écrit inspect.
//
// Le bucket est privé. C'est la moitié du contrôle d'accès — public, son URL
// suffirait à contourner `is_public` — et l'autre moitié est la route, qui
// vérifie qui regarde avant d'appeler ce module. Rien ici ne doit être importé
// depuis un composant client : la clé de service contourne RLS.
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
 * Un run lancé avant que ce dossier existe, ou un job mort avant qu'inspect
 * n'écrive, n'en a aucun — c'est un état normal, pas une erreur, et c'est ce
 * qui décide de l'affichage du bouton. Une panne de Storage donne le même
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
 * La réponse est relayée sans être lue : le viewer demande des tranches d'un
 * ZIP par `Range`, et les relire ici pour les recomposer coûterait la mémoire
 * du serveur sur des fichiers qu'il n'a aucune raison d'ouvrir.
 *
 * Le nom est validé avant d'être collé dans l'URL : sans ça, un `..` sortirait
 * du préfixe du run et donnerait le journal d'un autre — y compris non publié.
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
