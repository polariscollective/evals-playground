// Who has the right to read a run's logs.
//
// One function decides, and both `/inspect-view` routes call it first. It
// redoes `loadPublicRun`'s rule — a live run, and either a valid session or
// `is_public` — without loading the whole run: serving a log does not require
// knowing its cells.
//
// A module of its own rather than one more function in `runs.ts`: that one is
// 607 lines already and has never needed to know about authentication.
import "server-only";
import { requireUser } from "@/auth";
import { RUNS, select } from "./supabase";

/** Does the run exist, and can this caller read its logs?
 *
 * An unknown run, one in the bin, or one unpublished in front of a stranger all
 * give `false`: from outside they must look alike, otherwise the address says
 * who exists. */
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
