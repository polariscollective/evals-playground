import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, softDeleteRun } from "@/lib/runs";

/** Setting a run aside — the bin, not erasure.
 *
 * Under `/delete` rather than a `DELETE` on the run's route: that one already
 * serves to read it, and a verb that erases nothing gains from saying so in its
 * address.
 *
 * Everybody can set aside everybody's run, as everybody can already read and
 * relaunch everything: it is a team, not a permission system. What protects is
 * not the access right but the fact that nothing is lost — the row stays, only
 * its visibility changes. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  try {
    // Check first: a PostgREST PATCH on an unknown identifier touches no row and
    // answers 204, which would read as a success.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  await softDeleteRun(runId);
  return NextResponse.json({ ok: true });
}
