import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { ConfigProblem, NotFound, addJudgeNotes } from "@/lib/runs";

/** Adds one named judge note to some scenarios of this run, finished or not.
 *  Body: `{ name, notes: { "<scenario index>": "<text>" } }`. A note is never
 *  changed or removed: a name one of those scenarios already carries is
 *  refused, and nothing is written. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    notes?: unknown;
  } | null;
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "name must be text" }, { status: 422 });
  }
  const notes = body.notes;
  if (
    !notes ||
    typeof notes !== "object" ||
    Array.isArray(notes) ||
    Object.values(notes).some((text) => typeof text !== "string")
  ) {
    return NextResponse.json(
      { error: "notes must map scenario indices to their texts" },
      { status: 422 },
    );
  }

  try {
    const config = await addJudgeNotes(runId, body.name, notes as Record<string, string>);
    return NextResponse.json({ ok: true, scenarios: config.scenarios.length });
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ConfigProblem) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
