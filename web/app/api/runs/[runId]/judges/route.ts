import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, addJudge, loadRun } from "@/lib/runs";
import { judgeSpecProblem } from "@/lib/validate";
import type { JudgeSpec } from "@/lib/types";

/** Ajoute un juge secondaire à ce run — jamais principal, voir
 *  `designatePrincipal` (`.../judges/[runJudgeId]/principal/route.ts`) pour
 *  ce second geste, séparé et explicite.
 *
 * C'est ce que « rejuger » est devenu depuis les juges multiples : on
 * n'écrase plus le verdict du principal, on ajoute un juge de plus, et
 * l'ancien reste pour comparer. Ses lignes de score naissent en attente sur
 * toutes les conversations déjà posées ; `.../catchup` est ce qui les
 * remplit ensuite — voir `.superpowers/sdd/task-9-report.md`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as JudgeSpec | null;
  const problem = judgeSpecProblem(body, "the new judge");
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

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
    // Même garde qu'`extendRun` (`.../extend/route.ts`), et pour la même
    // raison : un job en cours a déjà lu ses juges vivants à son démarrage
    // (voir `juges_vivants` dans `batch_job.py`) et ne verrait jamais celui
    // qu'on vient d'ajouter. Le rattrapage, une fois le run terminé,
    // comblera ce qu'il a manqué.
    return NextResponse.json(
      { error: "This run is still going. Wait for it to finish." },
      { status: 409 },
    );
  }

  const { runJudgeId } = await addJudge(runId, body!, user.email);
  return NextResponse.json({ ok: true, run_judge_id: runJudgeId });
}
