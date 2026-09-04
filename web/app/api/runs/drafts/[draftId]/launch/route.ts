import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { DraftNotFound, deleteDraft, loadDraft } from "@/lib/drafts";
import { createRun, failToStart, recordStart } from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";

/** Lance un brouillon : le même chemin que `POST /api/runs`, config et auteur
 *  près, mais tirés du brouillon plutôt que du corps de la requête. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  let draft;
  try {
    draft = await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const problem = configProblem(draft.config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const run = await createRun(draft.config, user.email, draft.csv_text);
  try {
    await recordStart(run.id, await startJob(run.id, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(run.id, reason);
    return NextResponse.json({ run_id: run.id, error: reason }, { status: 502 });
  }
  await deleteDraft(draftId);
  return NextResponse.json({ run_id: run.id }, { status: 201 });
}
