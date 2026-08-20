import { NextResponse } from "next/server";
import { NotFound, loadRun, saveNotes } from "@/lib/runs";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const body = (await request.json().catch(() => ({}))) as { notes?: string };
  if (typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes must be a string" }, { status: 422 });
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
  await saveNotes(runId, body.notes);
  return NextResponse.json({ ok: true });
}
