import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  DraftNotFound,
  discardDraft,
  loadDraft,
  markDraftLaunched,
  updateDraft,
} from "@/lib/drafts";
import type { EvalRunConfig } from "@/lib/types";

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

/** Les deux façons de reprendre un brouillon en main.
 *
 * `launched` : il a servi. Il sort de la liste d'attente sans être jeté — son
 * adresse reste ouverte, et ce qu'il a produit se lit sur le run, qui porte
 * `draft_id`.
 *
 * `config` : on le réécrit en place, après l'avoir rouvert et corrigé.
 * Remplacer plutôt qu'en semer un second, sans quoi la liste d'attente
 * accumulerait des doublons dont on ne saurait plus lequel est le bon.
 *
 * Pas de validation sur le second : un brouillon manuel a le droit d'être
 * incomplet, c'est même sa raison d'être. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  const body = (await request.json().catch(() => null)) as {
    launched?: unknown;
    config?: unknown;
    csv_text?: unknown;
  } | null;

  if (body?.launched === true) {
    await markDraftLaunched(draftId);
    return NextResponse.json({ ok: true });
  }

  if (body && typeof body.config === "object" && body.config !== null) {
    await updateDraft(
      draftId,
      body.config as EvalRunConfig,
      typeof body.csv_text === "string" ? body.csv_text : null,
    );
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    { error: "send either launched: true or config" },
    { status: 422 },
  );
}
