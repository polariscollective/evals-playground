import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";
import { setRunTags, tagsOf } from "@/lib/tags";

/** This run's tags — what `TagField` loads on display. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  return NextResponse.json(await tagsOf(runId));
}

/** Lays down a run's list of tags, as it stands. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { tag_ids?: unknown } | null;
  const ids = body?.tag_ids;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) {
    return NextResponse.json({ error: "tag_ids must be a list of integers" }, { status: 422 });
  }

  try {
    // Check existence first: without it, laying tags on an unknown identifier
    // would write links that nothing attaches to.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  await setRunTags(runId, ids as number[]);
  return NextResponse.json({ ok: true });
}
