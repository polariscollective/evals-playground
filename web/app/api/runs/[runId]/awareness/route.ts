import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
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
    // `withAwarenessMissingFlag: true` demande le compte que cette garde lit
    // juste en dessous — sans lui, `awarenessMissingTotal` renverrait
    // toujours zéro, calcul sur demande oblige (voir `lib/runs.ts`). La
    // demande ne coûte rien de plus ici : les transcripts sont déjà en main,
    // donc le compte se fait en mémoire plutôt que par une lecture à part.
    detail = await loadRun(runId, {
      withTranscripts: true,
      withAwarenessMissingFlag: true,
    });
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
  // `awareness_missing` vient de `loadRun`, qui l'a calculé sur ces mêmes
  // transcripts : le recalculer ici recompterait la même chose une seconde
  // fois. Ce zéro a deux causes bien distinctes — tout est déjà noté, ou rien
  // n'est jugeable (conversation jamais jouée, ou bloquée sur chaque tour) —
  // et le message ne doit affirmer ni l'une ni l'autre à tort.
  if (detail.awareness_missing === 0) {
    return NextResponse.json(
      {
        error:
          "No conversation in this run needs an eval-awareness grade — either " +
          "every one already has one, or none of them has content to judge.",
      },
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
