import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, saveLabel } from "@/lib/runs";

/** Renames a run.
 *
 * Open to any session, like the notes and the analysis right beside it: this
 * application is that of a team looking at the same runs, and nothing elsewhere
 * in its routes reserves writing to the creator. The MCP tool, for its part,
 * does reserve it — an agent has no business renaming what it did not launch. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => ({}))) as { label?: unknown };
  if (typeof body.label !== "string") {
    return NextResponse.json({ error: "label must be a string" }, { status: 422 });
  }

  try {
    // Check existence first: a PostgREST PATCH on an unknown identifier touches
    // no row and answers 204, which would read as a successful save.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  // Emptied means "no name", not "empty name" — see `saveLabel`.
  const trimmed = body.label.trim();
  await saveLabel(runId, trimmed === "" ? null : trimmed);
  return NextResponse.json({ ok: true, label: trimmed === "" ? null : trimmed });
}
