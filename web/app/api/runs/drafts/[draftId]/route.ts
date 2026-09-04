import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { DraftNotFound, loadDraft } from "@/lib/drafts";

/** Le contenu d'un brouillon, pour que le formulaire l'ouvre prérempli.
 *
 * Gardée comme les autres routes `/api` : un brouillon porte la configuration
 * qu'un agent a soumise, pas un contenu public. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  try {
    const draft = await loadDraft(draftId);
    return NextResponse.json({
      config: draft.config,
      csv_text: draft.csv_text,
    });
  } catch (error) {
    if (error instanceof DraftNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
