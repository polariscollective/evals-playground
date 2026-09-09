import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { DraftNotFound, loadDraft } from "@/lib/drafts";
import { setDraftTags, tagsOfDraft } from "@/lib/tags";

/** This draft's tags — what `TagField` loads on display. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  return NextResponse.json(await tagsOfDraft(draftId));
}

/** Lays down a draft's list of tags, as it stands. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  const body = (await request.json().catch(() => null)) as { tag_ids?: unknown } | null;
  const ids = body?.tag_ids;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) {
    return NextResponse.json({ error: "tag_ids must be a list of integers" }, { status: 422 });
  }

  try {
      // Check existence first: without it, laying tags on an unknown identifier
      // would write links that nothing attaches to.
    await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  await setDraftTags(draftId, ids as number[]);
  return NextResponse.json({ ok: true });
}
