import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, saveLabel } from "@/lib/runs";

/** Renomme un run.
 *
 * Ouvert à toute session, comme les notes et l'analyse juste à côté : cette
 * application est celle d'une équipe qui regarde les mêmes runs, et rien
 * ailleurs dans ses routes ne réserve l'écriture au créateur. L'outil MCP,
 * lui, la réserve — un agent n'a pas à renommer ce qu'il n'a pas lancé. */
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
    // Vérifier l'existence d'abord : un PATCH PostgREST sur un identifiant
    // inconnu ne touche aucune ligne et répond 204, ce qui se lirait comme un
    // enregistrement réussi.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  // Vidé vaut « pas de nom », pas « nom vide » — voir `saveLabel`.
  const trimmed = body.label.trim();
  await saveLabel(runId, trimmed === "" ? null : trimmed);
  return NextResponse.json({ ok: true, label: trimmed === "" ? null : trimmed });
}
