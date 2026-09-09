import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";

/** A run and its cells, plus its living judges and their verdicts.
 *
 * `?transcripts=1` brings back the conversations AND the complete verdicts of
 * EVERY living judge — the two weigh for the same reason and are always asked
 * for together: see `attachJudges` in `lib/runs.ts`. Without that parameter,
 * only the PRINCIPAL judge's verdicts and those of the awareness link if there
 * is one are brought back — what the matrix and its indicator show without
 * anything being unfolded; the refresh of a running run makes do with that.
 *
 * `?full_judges=1` also brings back the complete verdicts of every living judge,
 * but without the conversations: it is what the screen asks for as soon as one
 * looks at a secondary judge (see `app/eval/[runId]/page.tsx`), so as not to pay
 * the transcripts' weight for the sole reason of changing the judge shown — see
 * `withFullJudgeScores` on `loadRun` (`lib/runs.ts`).
 *
 * `withJudges: true`: it is what makes `detail.judges` exist — see
 * `components/RunRead.tsx`, written against this contract before this route
 * really laid it down.
 *
 * `withCatchupMissingFlag: true`: it is this route that feeds the page's
 * catch-up button — see `catchupMissingTotal` in `lib/runs.ts` for why that
 * count is asked for only here and on the route that starts the pass. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const withTranscripts = searchParams.get("transcripts") === "1";
  const withFullJudgeScores = searchParams.get("full_judges") === "1";
  try {
    return NextResponse.json(
      await loadRun(runId, {
        withTranscripts,
        withJudges: true,
        withCatchupMissingFlag: true,
        withFullJudgeScores,
        // The indicator of the served results, and its crossing with awareness.
        // One more read per run opening, on a table most often empty — it is the
        // run's page, not the list, that pays for it.
        withToolResults: true,
      }),
    );
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
