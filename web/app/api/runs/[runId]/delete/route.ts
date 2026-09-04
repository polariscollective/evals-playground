import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, softDeleteRun } from "@/lib/runs";

/** Écarter un run — la corbeille, pas l'effacement.
 *
 * Sous `/delete` plutôt qu'un `DELETE` sur la route du run : celle-ci sert
 * déjà à le lire, et un verbe qui n'efface rien gagne à le dire dans son
 * adresse.
 *
 * Tout le monde peut écarter le run de tout le monde, comme tout le monde
 * peut déjà tout lire et tout relancer : c'est une équipe, pas un système de
 * permissions. Ce qui protège n'est pas le droit d'accès mais le fait que
 * rien n'est perdu — la ligne reste, seule sa visibilité change. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  try {
    // Vérifier d'abord : un PATCH PostgREST sur un identifiant inconnu ne
    // touche aucune ligne et répond 204, ce qui se lirait comme un succès.
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
