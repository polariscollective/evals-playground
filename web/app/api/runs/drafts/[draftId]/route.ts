import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  DraftNotFound,
  discardDraft,
  loadDraft,
  markDraftLaunched,
} from "@/lib/drafts";

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

/** Jeter un brouillon : la corbeille.
 *
 * Il sort de la liste et son adresse cesse de répondre — c'est ce qui le
 * distingue d'un brouillon lancé. Rien n'est effacé pour autant.
 *
 * Silencieuse sur un brouillon déjà jeté : deux onglets qui font le même
 * geste ne doivent pas produire une erreur sur le second. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  await discardDraft(draftId);
  return NextResponse.json({ ok: true });
}

/** Marquer un brouillon comme lancé, et dire quel run il a produit.
 *
 * Appelée par le formulaire après un lancement réussi : le brouillon a servi,
 * et le laisser en attente ferait croire qu'il reste à faire. Son adresse
 * reste ouverte, contrairement à la corbeille. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  const body = (await request.json().catch(() => null)) as {
    launched_run_id?: unknown;
  } | null;
  if (typeof body?.launched_run_id !== "string") {
    return NextResponse.json(
      { error: "launched_run_id must be a run id" },
      { status: 422 },
    );
  }

  await markDraftLaunched(draftId, body.launched_run_id);
  return NextResponse.json({ ok: true });
}
