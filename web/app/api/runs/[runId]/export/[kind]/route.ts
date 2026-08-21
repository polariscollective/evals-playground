import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";
import { detailsCsv, matrixCsv } from "@/lib/exports";
import { csvResponse } from "@/lib/csv-response";
import { isPlainView, viewFromQuery } from "@/lib/view";

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
    // La vue vient de la requête : le serveur ne voit pas l'écran, et un CSV
    // qui dirait autre chose que la matrice affichée serait pire qu'inutile.
    // Le détail, lui, porte les notes brutes du juge et n'a rien à en faire.
    const view = viewFromQuery(new URL(request.url).searchParams);
    const body =
      kind === "matrix"
        ? matrixCsv(run, samples, view)
        : detailsCsv(run, samples);
    // Le nom du fichier porte la vue : deux exports du même run, lus
    // différemment, ne doivent pas s'écraser dans le dossier des
    // téléchargements. Le repli de l'échelle y figure aussi, sans quoi une
    // moyenne sur échelle repliée porterait le même nom qu'une moyenne nue.
    const suffix =
      kind === "matrix" && !isPlainView(view)
        ? `-${view.aggregate}${Object.keys(view.remap).length > 0 ? "-remapped" : ""}`
        : "";
    return csvResponse(body, `${kind}${suffix}-${runId}.csv`);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
