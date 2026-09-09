import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, cancelRun, loadRun } from "@/lib/runs";

/** Asks for a running run to stop.
 *
 * Stops nothing directly: writes `cancelled` on the run, which the job reads
 * before each cell. Killing the Cloud Run execution would be more brutal without
 * being cleaner — the container would die mid-write and the cells would stay
 * running forever. Here the job ends itself, marks what it did not do and
 * records what it consumed.
 *
 * A consequence to accept: the cell under way runs to its end. What costs is the
 * model calls, not the container's seconds.
 */
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

  // A finished run is not cancelled. Saying so rather than writing `cancelled`
  // over a `done`: that would erase a result already acquired.
  if (detail.run.status !== "triggered" && detail.run.status !== "running") {
    return NextResponse.json(
      { error: `This run is already ${detail.run.status}.` },
      { status: 409 },
    );
  }

  await cancelRun(runId);
  return NextResponse.json({ ok: true });
}
