// Qui a le droit de lire les journaux d'un run.
//
// One function decides, and both `/inspect-view` routes call it first. It
// redoes `loadPublicRun`'s rule — a live run,
// et soit une session valide, soit `is_public` — sans charger le run entier :
// serving a log does not require knowing its cells.
//
// A module of its own rather than one more function in `runs.ts`: that one is
// 607 lines already and has never needed to know about authentication.
import "server-only";
import { requireUser } from "@/auth";
import { RUNS, select } from "./supabase";

/** Le run existe-t-il, et cet appelant peut-il en lire les journaux ?
 *
 * An unknown run, one in the bin, or one unpublished in front of a stranger all
 * tous `false` : de dehors ils doivent se ressembler, sinon l'adresse dit qui
 * existe. */
export async function canReadRun(runId: string): Promise<boolean> {
  const rows = await select<{ is_public: boolean | null }>(RUNS, {
    id: `eq.${runId}`,
    deleted_at: "is.null",
    select: "is_public",
    limit: 1,
  });
  const run = rows[0];
  if (!run) return false;
  if (run.is_public === true) return true;

  const user = await requireUser();
  return !("response" in user);
}
