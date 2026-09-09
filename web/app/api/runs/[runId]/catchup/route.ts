import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  NotFound,
  failToStart,
  loadRun,
  recordStart,
  startCatchupPass,
} from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { worldEquivalenceProblem } from "@/lib/validate";

/** Fills in the rows of `judge_scores` still pending OR in error on this run,
 *  for every living link and every conversation already finished.
 *
 * Generalises the old awareness button to any judge: a judge added afterwards, a
 * run extended, a judge fallen over on a few cells, a run interrupted — all are
 * covered by the same gesture, one single mode in the job (`catchup`, see
 * `run_batch_job`, `backend/playground/batch_job.py`). See
 * `.superpowers/sdd/task-9-report.md` for what this route replaces.
 *
 * With no body: nothing to set, the job finds what is left on its own. Touches
 * no grade already returned: the transcripts are reread, the evaluated models
 * and the adversary are not called again. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;

  let detail;
  try {
      // `withCatchupMissingFlag: true` asks for the count the guard below reads —
      // without it, `catchupMissingTotal` would always return zero, being computed
      // on demand (see `lib/runs.ts`). No need for the transcripts: that count no
      // longer rereads the conversations themselves, only the status of
      // `judge_scores` and of `eval_samples`.
    detail = await loadRun(runId, { withCatchupMissingFlag: true });
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

  // `catchup_missing` comes from `loadRun`, which computed it just now:
  // recomputing it here would count the same thing a second time — see
  // `catchupMissingTotal`, the one function that carries that count, called from
  // both sides (the display, and this guard). Read only, hence before the guard
  // that follows: a run with nothing to catch up must not be told its
  // configuration is broken (CRITICAL 1).
  if (detail.catchup_missing === 0) {
    return NextResponse.json(
      {
        error:
          "Nothing to catch up on this run — every live judge already has a " +
          "grade on every finished conversation.",
      },
      { status: 409 },
    );
  }

  // Same guard as `retry` (see CRITICAL 1): a run launched before `models.world`
  // may serve tools without naming one, and the job applies the same equivalence
  // as `extendProblem` — a cold raise that would erase the cost already recorded.
  // Only that equivalence, never the whole `configProblem`: the latter also
  // refuses faults a run recorded before this project already carries without the
  // job minding (`average_output_tokens`, notably), and which `retry`/`catchup`
  // cannot repair anyway.
  const worldProblem = worldEquivalenceProblem(detail.run.config);
  if (worldProblem) {
    return NextResponse.json(
      {
        error:
          "This run serves at least one tool but names no model to answer its " +
          "calls — it was launched before models.world was a per-run choice. " +
          "Catch-up cannot supply it: reopen the run in the composer instead, " +
          "which prefills everything already recorded and asks for the model " +
          "that's missing.",
      },
      { status: 422 },
    );
  }

  await startCatchupPass(runId);

  try {
    await recordStart(runId, await startJob(runId, "catchup"));
  } catch (error) {
    const reason = `Could not start the catch-up pass: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
