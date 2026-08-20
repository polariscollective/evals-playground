import { NextResponse } from "next/server";
import { getSessionEmail } from "@/auth";
import { createRun, failToStart, loadRuns, recordExecution } from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";
import type { EvalRunConfig } from "@/lib/types";

export async function GET() {
  return NextResponse.json(await loadRuns());
}

/** Crée un run, écrit toute sa matrice en attente, puis démarre le job.
 *
 * Dans cet ordre : le run existe en base avant que quoi que ce soit ne tourne,
 * si bien qu'un déclenchement raté laisse une trace visible plutôt qu'un
 * silence. */
export async function POST(request: Request) {
  const userEmail = await getSessionEmail();
  if (!userEmail) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    config?: EvalRunConfig;
    csv_text?: string | null;
  } | null;

  const problem = configProblem(body?.config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  // L'auteur vient de la session, jamais de ce que le client prétend.
  const run = await createRun(body!.config!, userEmail, body?.csv_text ?? null);

  try {
    await recordExecution(run.id, await startJob(run.id, "run"));
  } catch (error) {
    // Sans ça, le run resterait en attente jusqu'à ce que la fonction
    // d'expiration le ramasse deux heures plus tard, avec un message parlant
    // d'un job disparu plutôt que d'un job jamais lancé.
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(run.id, reason);
    return NextResponse.json({ run_id: run.id, error: reason }, { status: 502 });
  }

  return NextResponse.json({ run_id: run.id }, { status: 201 });
}
