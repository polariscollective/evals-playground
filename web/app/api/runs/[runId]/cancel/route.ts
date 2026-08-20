import { NextResponse } from "next/server";
import { NotFound, cancelRun, loadRun } from "@/lib/runs";

/** Demande l'arrêt d'un run en cours.
 *
 * N'arrête rien directement : écrit `cancelled` sur le run, que le job lit
 * avant chaque case. Tuer l'exécution Cloud Run serait plus brutal sans être
 * plus propre — le conteneur mourrait en pleine écriture et les cases
 * resteraient en cours pour toujours. Ici le job se termine lui-même, marque ce
 * qu'il n'a pas fait et enregistre ce qu'il a consommé.
 *
 * Conséquence à assumer : la case en cours va à son terme. Ce qui coûte, ce
 * sont les appels de modèle, pas les secondes de conteneur.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  let detail;
  try {
    detail = await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  // Un run terminé ne s'annule pas. Le dire plutôt que d'écrire `cancelled`
  // par-dessus un `done` : ça effacerait un résultat acquis.
  if (detail.run.status !== "triggered" && detail.run.status !== "running") {
    return NextResponse.json(
      { error: `This run is already ${detail.run.status}.` },
      { status: 409 },
    );
  }

  await cancelRun(runId);
  return NextResponse.json({ ok: true });
}
