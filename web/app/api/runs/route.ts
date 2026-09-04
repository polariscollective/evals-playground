import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createRun, failToStart, loadRuns, recordStart } from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";
import type { EvalRunConfig } from "@/lib/types";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  return NextResponse.json(await loadRuns());
}

/** Crée un run, écrit toute sa matrice en attente, puis démarre le job.
 *
 * Dans cet ordre : le run existe en base avant que quoi que ce soit ne tourne,
 * si bien qu'un déclenchement raté laisse une trace visible plutôt qu'un
 * silence. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    config?: EvalRunConfig;
    csv_text?: string | null;
    draft_id?: string | null;
  } | null;

  const problem = configProblem(body?.config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  // L'auteur vient de la session, jamais de ce que le client prétend. Le
  // brouillon d'origine, lui, ne peut venir que du client : c'est lui qui sait
  // sur quoi le formulaire était ouvert, et s'en tromper ne fait qu'attribuer
  // une provenance, jamais un droit.
  const run = await createRun(
    body!.config!,
    user.email,
    body?.csv_text ?? null,
    body?.draft_id ?? null,
  );

  try {
    await recordStart(run.id, await startJob(run.id, "run"));
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
