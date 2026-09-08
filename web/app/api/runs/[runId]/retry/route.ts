import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  NotFound,
  failToStart,
  failedCellCount,
  loadRun,
  recordStart,
  retryFailed,
} from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { worldEquivalenceProblem } from "@/lib/validate";

/** Relance les cases en erreur d'un run, dans ce même run.
 *
 * Un nouveau run serait une autre expérience : une panne de fournisseur sur
 * quinze cases n'en est pas une, et la matrice doit se refermer là où elle s'est
 * trouée. Le job ne déroule que les cases `pending`, donc seules celles-là sont
 * repayées. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

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

  if (detail.run.status === "triggered" || detail.run.status === "running") {
    return NextResponse.json(
      { error: "This run is still going. Wait for it to finish." },
      { status: 409 },
    );
  }

  // Lu, pas encore agi : `retryFailed` mute dès qu'il trouve quelque chose,
  // et l'appeler seulement pour compter aurait déjà remis des cases en
  // `pending` avant même de savoir si le job pourrait démarrer.
  if ((await failedCellCount(runId)) === 0) {
    return NextResponse.json(
      { error: "This run has no failed cell to retry." },
      { status: 409 },
    );
  }

  // Un run lancé avant que `models.world` existe peut servir des outils sans
  // en nommer un : le job applique la même équivalence qu'`extendProblem`
  // (voir CRITICAL 1) et lèverait à froid, effaçant au passage le coût déjà
  // enregistré (`check_served_results` avant `finish_run`). Vérifié ici
  // plutôt que découvert dans les logs du job — et seulement cette
  // équivalence, jamais `configProblem` entier : ce dernier refuse aussi des
  // fautes qu'un run enregistré avant ce chantier porte déjà sans que le job
  // s'en soucie (`average_output_tokens`, notamment), et qu'`ExtendRequest` ne
  // sait de toute façon pas réparer. Après le 409 ci-dessus, et avant toute
  // écriture : un run qui n'a rien à retenter n'a pas à s'entendre dire que sa
  // configuration est cassée, et un run dont la configuration l'est ne doit
  // pas se retrouver `triggered` avec des cases en `pending` sans qu'aucun job
  // ne démarre pour les jouer.
  const worldProblem = worldEquivalenceProblem(detail.run.config);
  if (worldProblem) {
    return NextResponse.json(
      {
        error:
          "This run serves at least one tool but names no model to answer its " +
          "calls — it was launched before models.world was a per-run choice. " +
          "Retry cannot supply it: reopen the run in the composer instead, " +
          "which prefills everything already recorded and asks for the model " +
          "that's missing.",
      },
      { status: 422 },
    );
  }

  const retried = await retryFailed(runId);

  try {
    await recordStart(runId, await startJob(runId, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true, retried });
}
