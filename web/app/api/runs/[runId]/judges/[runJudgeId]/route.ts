import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, PrincipalRequiresReplacement, unlinkJudge } from "@/lib/runs";

/** Unlinks a judge from this run: marks its link deleted, never the judge
 *  itself — see `unlinkJudge` (`lib/runs.ts`) for what that changes in the
 *  database, and why it is an RPC function that does it in one transaction.
 *
 * `replacement_run_judge_id`: required only to unlink the principal while other
 * living links remain on this run — the database refuses it otherwise
 * (`PrincipalRequiresReplacement`), and that is deliberate. `null` (or the
 * field's absence) unlinks with no replacement, which is a problem in that one
 * precise case only. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ runId: string; runJudgeId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId, runJudgeId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    replacement_run_judge_id?: string | null;
  };

  try {
    await unlinkJudge(runId, runJudgeId, body.replacement_run_judge_id ?? null);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PrincipalRequiresReplacement) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
