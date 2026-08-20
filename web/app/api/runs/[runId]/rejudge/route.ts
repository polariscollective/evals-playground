import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, failToStart, loadRun, recordStart, resetForRejudge } from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { rejudgeProblem } from "@/lib/validate";
import type { RejudgeRequest } from "@/lib/types";

/** Rejoue le juge sur toutes les cases d'un run.
 *
 * Les transcripts ne sont pas touchés et les modèles évalués ne sont pas
 * rappelés : cette passe ne coûte que le juge. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as RejudgeRequest | null;

  const problem = rejudgeProblem(body);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  let detail;
  try {
    // Avec les transcripts : c'est sur eux que porte la garde « rien à juger »
    // plus bas, et sans eux `messages` serait vide partout, ce qui refuserait
    // toutes les passes. Une repasse est rare et délibérée — la justesse vaut
    // mieux que les octets épargnés.
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
  if (detail.samples.every((sample) => sample.messages.length === 0)) {
    // Sans transcript il n'y a rien à juger : la passe tournerait à vide et
    // détruirait les notes existantes pour rien.
    return NextResponse.json(
      { error: "This run has no conversation to judge." },
      { status: 409 },
    );
  }

  await resetForRejudge(runId, {
    ...detail.run.config,
    criterion: body!.criterion,
    rubric: body!.rubric,
    models: { ...detail.run.config.models, judge: body!.judge },
  });

  try {
    await recordStart(runId, await startJob(runId, "rejudge"));
  } catch (error) {
    const reason = `Could not start the judging pass: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
