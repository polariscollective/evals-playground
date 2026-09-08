import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, failToStart, loadRun, recordStart, retryFailed } from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";

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

  // Un run lancé avant que `models.world` existe peut servir des outils sans
  // en nommer un : le job reconstruit sa configuration avec le même
  // validateur qu'`extendProblem` (voir B2), et lèverait à froid, effaçant au
  // passage le coût déjà enregistré (`check_served_results` avant
  // `finish_run`). Vérifié ici plutôt que découvert dans les logs du job.
  const problem = configProblem(detail.run.config);
  if (problem) {
    return NextResponse.json(
      {
        error:
          `This run's saved configuration can no longer run as is: ${problem} ` +
          "Extend the run to supply what's missing, then retry.",
      },
      { status: 422 },
    );
  }

  const retried = await retryFailed(runId);
  if (retried === 0) {
    return NextResponse.json(
      { error: "This run has no failed cell to retry." },
      { status: 409 },
    );
  }

  try {
    await recordStart(runId, await startJob(runId, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true, retried });
}
