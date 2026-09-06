import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  NotFound,
  failToStart,
  loadRun,
  recordStart,
  startCatchupPass,
} from "@/lib/runs";
import { startJob } from "@/lib/trigger";

/** Remplit les lignes de `judge_scores` encore en attente sur ce run, pour
 *  toute liaison vivante et toute conversation déjà terminée.
 *
 * Généralise l'ancien bouton d'éveil à n'importe quel juge : un juge ajouté
 * après coup, un run étendu, un juge tombé sur quelques cases, un run
 * interrompu s'y couvrent tous du même geste — un seul mode dans le job
 * (`catchup`, voir `run_batch_job`, `backend/playground/batch_job.py`). Voir
 * `.superpowers/sdd/task-9-report.md` pour ce que cette route remplace.
 *
 * Sans corps : rien à régler, le job retrouve lui-même ce qui reste. Ne
 * touche aucune note déjà rendue : les transcripts sont relus, les modèles
 * évalués et l'adversaire ne sont pas rappelés. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;

  let detail;
  try {
    // `withCatchupMissingFlag: true` demande le compte que la garde
    // ci-dessous lit — sans lui, `catchupMissingTotal` renverrait toujours
    // zéro, calcul sur demande oblige (voir `lib/runs.ts`). Pas besoin des
    // transcripts : ce compte ne relit plus les conversations elles-mêmes,
    // seulement le statut de `judge_scores` et d'`eval_samples`.
    detail = await loadRun(runId, { withCatchupMissingFlag: true });
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
  // `catchup_missing` vient de `loadRun`, qui l'a calculé à l'instant : le
  // recalculer ici recompterait la même chose une seconde fois — voir
  // `catchupMissingTotal`, l'unique fonction qui porte ce compte, appelée
  // des deux côtés (l'affichage, et cette garde).
  if (detail.catchup_missing === 0) {
    return NextResponse.json(
      {
        error:
          "Nothing to catch up on this run — every live judge already has a " +
          "grade or an error on every finished conversation.",
      },
      { status: 409 },
    );
  }

  await startCatchupPass(runId);

  try {
    await recordStart(runId, await startJob(runId, "catchup"));
  } catch (error) {
    const reason = `Could not start the catch-up pass: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
