import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";
import { detailsCsv, matrixCsv } from "@/lib/exports";
import { csvResponse } from "@/lib/csv-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; kind: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId, kind } = await params;
  if (kind !== "matrix" && kind !== "details") {
    return NextResponse.json({ error: `Unknown export: ${kind}` }, { status: 404 });
  }

  try {
    // Le détail recopie les transcripts ; la matrice ne s'en sert pas, mais
    // une seule lecture évite deux chemins à tenir alignés.
    const { run, samples } = await loadRun(runId, { withTranscripts: true });
    const body = kind === "matrix" ? matrixCsv(run, samples) : detailsCsv(run, samples);
    return csvResponse(body, `${kind}-${runId}.csv`);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
