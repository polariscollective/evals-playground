import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  NotFound,
  failToStart,
  failedCellCount,
  loadRun,
  recordStart,
  retryFailed,
} from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { worldEquivalenceProblem } from "@/lib/validate";

/** Replays a run's cells in error, within that same run.
 *
 * A new run would be another experiment: a provider outage on fifteen cells is
 * not one, and the matrix must close back up where it was holed. The job plays
 * out only the `pending` cells, so only those are paid for again. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;

  let detail;
  try {
    detail = await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  if (detail.run.status === "triggered" || detail.run.status === "running") {
    return NextResponse.json(
      { error: "This run is still going. Wait for it to finish." },
      { status: 409 },
    );
  }

  // Read, not yet acted on: `retryFailed` mutates as soon as it finds anything,
  // and calling it only to count would already have put cells back to `pending`
  // before even knowing whether the job could start.
  if ((await failedCellCount(runId)) === 0) {
    return NextResponse.json(
      { error: "This run has no failed cell to retry." },
      { status: 409 },
    );
  }

  // A run launched before `models.world` existed may serve tools without naming
  // one: the job applies the same equivalence as `extendProblem` (see CRITICAL 1)
  // and would raise cold, erasing on the way the cost already recorded
  // (`check_served_results` before `finish_run`). Checked here rather than
  // discovered in the job's logs — and only that equivalence, never the whole
  // `configProblem`: the latter also refuses faults a run recorded before this
  // project already carries without the job minding (`average_output_tokens`,
  // notably), and which `ExtendRequest` cannot repair anyway. After the 409
  // above, and before any write: a run with nothing to retry must not be told its
  // configuration is broken, and a run whose configuration is must not find
  // itself `triggered` with cells `pending` and no job starting to play them.
  const worldProblem = worldEquivalenceProblem(detail.run.config);
  if (worldProblem) {
    return NextResponse.json(
      {
        error:
          "This run serves at least one tool but names no model to answer its " +
          "calls — it was launched before models.world was a per-run choice. " +
          "Retry cannot supply it: reopen the run in the composer instead, " +
          "which prefills everything already recorded and asks for the model " +
          "that's missing.",
      },
      { status: 422 },
    );
  }

  const retried = await retryFailed(runId);

  try {
    await recordStart(runId, await startJob(runId, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true, retried });
}
