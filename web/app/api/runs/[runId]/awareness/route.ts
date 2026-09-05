import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { awarenessMissing } from "@/lib/awareness";
import { NotFound, failToStart, loadRun, recordStart, startAwarenessPass } from "@/lib/runs";
import { startJob } from "@/lib/trigger";

/** Passe le juge d'éveil sur un run qui ne l'avait pas.
 *
 * Sans corps : il n'y a rien à régler. La question du juge d'éveil est fixe,
 * son échelle aussi, et le modèle est celui du juge du run — c'est tout
 * l'intérêt d'une question qui n'appartient pas à l'utilisateur.
 *
 * Ne touche aucune note : les transcripts sont relus, le modèle évalué et
 * l'adversaire ne sont pas rappelés. Voir `write_awareness` côté job. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;

  let detail;
  try {
    // Avec les transcripts : c'est sur eux que porte la garde ci-dessous, et
    // sans eux `messages` serait vide partout, ce qui refuserait toute passe.
    detail = await loadRun(runId, { withTranscripts: true });
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  if (detail.run.status === "triggered" || detail.run.status === "running") {
    return NextResponse.json(
      { error: "This run is still going. Wait for it to finish." },
      { status: 409 },
    );
  }
  if (awarenessMissing(detail.samples) === 0) {
    return NextResponse.json(
      { error: "Every conversation in this run already has an eval-awareness grade." },
      { status: 409 },
    );
  }

  await startAwarenessPass(runId);

  try {
    await recordStart(runId, await startJob(runId, "awareness"));
  } catch (error) {
    const reason = `Could not start the eval-awareness pass: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
