import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, addJudge, loadRun } from "@/lib/runs";
import { judgeSpecProblem } from "@/lib/validate";
import type { JudgeSpec } from "@/lib/types";

/** Adds a secondary judge to this run — never a principal, see
 *  `designatePrincipal` (`.../judges/[runJudgeId]/principal/route.ts`) for that
 *  second, separate and explicit gesture.
 *
 * This is what "re-judging" has become since the multiple judges: the
 * principal's verdict is no longer overwritten, one more judge is added, and the
 * old one stays to compare. Its score rows are born pending on every
 * conversation already laid down; `.../catchup` is what fills them in
 * afterwards — see `.superpowers/sdd/task-9-report.md`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as JudgeSpec | null;
  const problem = judgeSpecProblem(body, "the new judge");
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

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
      // Same guard as `extendRun` (`.../extend/route.ts`), and for the same
      // reason: a running job has already read its living judges at its start
      // (see `living_judges` in `batch_job.py`) and would never see the one just
      // added. The catch-up, once the run has finished, will fill in what it
      // missed.
    return NextResponse.json(
      { error: "This run is still going. Wait for it to finish." },
      { status: 409 },
    );
  }

  const { runJudgeId } = await addJudge(runId, body!, user.email);
  return NextResponse.json({ ok: true, run_judge_id: runJudgeId });
}
