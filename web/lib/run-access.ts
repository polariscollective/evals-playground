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
import { getSessionAccess } from "@/auth";
import { sharedView, visibilityOf } from "./visibility";
import { RUNS, select } from "./supabase";

/** Does the run exist, and can this caller read its logs?
 *
 * An unknown run, one in the bin, or one unpublished in front of a stranger all
 * give `false`: from outside they must look alike, otherwise the address says
 * who exists. */
export async function canReadRun(runId: string): Promise<boolean> {
  const rows = await select<{ is_public: boolean | null; visibility?: string | null }>(RUNS, {
    id: `eq.${runId}`,
    deleted_at: "is.null",
    select: "*",
    limit: 1,
  });
  const run = rows[0];
  if (!run) return false;
  // The same rule as the shared page (`sharedView`), plus the members, who
  // read every run of the application.
  const access = await getSessionAccess();
  if (access === "member") return true;
  return sharedView(visibilityOf(run), access) === "show";
}
