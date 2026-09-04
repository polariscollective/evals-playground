import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { DraftNotFound, loadDraft } from "@/lib/drafts";
import { setDraftTags, tagsOfDraft } from "@/lib/tags";

/** Les tags de ce brouillon — ce que `TagField` charge à l'affichage. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  return NextResponse.json(await tagsOfDraft(draftId));
}

/** Pose la liste des tags d'un brouillon, telle quelle. */
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
    // Vérifier l'existence d'abord : sans ça, poser des tags sur un
    // identifiant inconnu écrirait des liens que rien ne rattache.
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
