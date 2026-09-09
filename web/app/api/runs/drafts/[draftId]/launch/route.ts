import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { DraftNotFound, loadDraft, markDraftLaunched } from "@/lib/drafts";
import { createRun, failToStart, recordStart } from "@/lib/runs";
import { setRunTags, tagsOfDraft } from "@/lib/tags";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";

/** Launches a draft: the same path as `POST /api/runs`, config and author
 *  aside, but drawn from the draft rather than from the request body. */
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

  // An extension draft is not launched here: it has no run to create, it
  // enlarges one. Its launch goes through the extension panel, on the page of
  // the run concerned, because it asks for a human confirmation — that is where
  // the offered tools finally apply.
  if (draft.kind !== "run") {
    return NextResponse.json(
      {
        error:
          "this draft extends a run — open it from the run's page instead",
        extends_run_id: draft.extends_run_id,
      },
      { status: 409 },
    );
  }

  const problem = configProblem(draft.config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const run = await createRun(draft.config, user.email, draft.csv_text, draftId);
  try {
    await recordStart(run.id, await startJob(run.id, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(run.id, reason);
    return NextResponse.json({ run_id: run.id, error: reason }, { status: 502 });
  }
  // Copy the tags now: the run exists and is running, and the draft is still
  // readable — after markDraftLaunched it would be no more dangerous here, but we
  // may as well stay on the right side of the boundary. A failure here must not
  // make the response fail: the run is already launched, and reporting an error
  // would lie to the caller about what succeeded. So we log rather than rethrow
  // the error.
  try {
    const tags = await tagsOfDraft(draftId);
    if (tags.length > 0) {
      await setRunTags(run.id, tags.map((tag) => tag.id));
    }
  } catch (error) {
    console.error(`Could not copy tags from draft ${draftId} to run ${run.id}:`, (error as Error).message);
  }

  // Marked launched, not erased: it leaves the waiting list and keeps its
  // address open for a relaunch. What it produced is read on the run, which
  // carries `draft_id` — several may carry it.
  await markDraftLaunched(draftId);
  return NextResponse.json({ run_id: run.id }, { status: 201 });
}
