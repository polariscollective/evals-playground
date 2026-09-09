import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, designatePrincipal } from "@/lib/runs";

/** Designates this run's principal: the judge the matrix shows — see
 *  `designatePrincipal` (`lib/runs.ts`).
 *
 * With no body: the address already carries all the information. Idempotent —
 * designating a judge that is already principal rewrites nothing. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string; runJudgeId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId, runJudgeId } = await params;
  try {
    await designatePrincipal(runId, runJudgeId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
