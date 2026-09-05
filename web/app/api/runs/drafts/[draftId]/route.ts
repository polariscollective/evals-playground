import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  DraftNotFound,
  discardDraft,
  loadDraft,
  markDraftLaunched,
  updateDraftOwned,
} from "@/lib/drafts";
import type { EvalRunConfig, ExtendRequest } from "@/lib/types";

/** Le contenu d'un brouillon, pour que le formulaire ou le panneau
 *  d'extension l'ouvre prérempli.
 *
 * Gardée comme les autres routes `/api` : un brouillon porte la configuration
 * qu'un agent a soumise, pas un contenu public.
 *
 * `mine` s'ajoute au brouillon lui-même : le navigateur ne connaît jamais
 * l'adresse de l'utilisateur courant — seule la route la lie à la session —
 * et ne peut donc pas comparer `created_by` par lui-même. C'est ce verdict-là
 * qu'un bouton lit pour s'annoncer « Save as my own copy » avant d'écrire,
 * plutôt que de le découvrir après coup dans une redirection. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  try {
    // Le brouillon entier : le genre en fait partie, et l'appelant ne peut
    // pas lire sa charge sans savoir comment la lire.
    const draft = await loadDraft(draftId);
    return NextResponse.json({ ...draft, mine: draft.created_by === user.email });
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
 * `config` : on le réécrit — en place pour son auteur, remplacer plutôt qu'en
 * semer un second, sans quoi la liste d'attente accumulerait des doublons
 * dont on ne saurait plus lequel est le bon. Mais pour n'importe qui d'autre,
 * la réécriture pose un nouveau brouillon à la place : l'original n'est pas
 * touché, exactement la règle que l'outil MCP `update_draft_run` applique
 * déjà — `updateDraftOwned` la porte pour les deux plutôt que de la répéter
 * ici sous une autre forme. `forked` le dit dans la réponse, pour que l'écran
 * navigue vers la bonne adresse au lieu de laisser croire qu'il éditait
 * encore l'original.
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
    try {
      const draft = await loadDraft(draftId);
      const result = await updateDraftOwned(
        draft,
        body.config as EvalRunConfig | ExtendRequest,
        typeof body.csv_text === "string" ? body.csv_text : null,
        user.email,
      );
      return NextResponse.json({
        ok: true,
        forked: result.forked,
        draft_id: result.draftId,
      });
    } catch (error) {
      if (error instanceof DraftNotFound) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
  }

  return NextResponse.json(
    { error: "send either launched: true or config" },
    { status: 422 },
  );
}
