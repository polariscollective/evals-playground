import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  NotFound,
  extendRun,
  failToStart,
  loadRun,
  recordStart,
} from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { DraftNotFound, loadDraft, markDraftLaunched } from "@/lib/drafts";
import { extendProblem, extensionDraftProblem } from "@/lib/validate";
import type { ExtendRequest } from "@/lib/types";

/** Adds a sub-matrix to an existing run: scenarios, models, repetitions.
 *
 * What this route does not accept is as important as what it does: no criterion,
 * no scale, no judge. A batch judged differently would no longer be comparable
 * to the first, and the matrix would no longer make sense as a matrix. What
 * cannot be sent cannot drift.
 *
 * Temperature and the number of turns are the exception: the first because it is
 * carried by each cell and not by the run, so the old ones keep theirs. The
 * turns can lengthen — never shorten — and if a cell is deepened, it is judged
 * again in full. The run's depth stays the same for all its cells: the
 * comparability holds. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as ExtendRequest | null;

  // `?draft=<id>`: this extension applies a draft, and the caller says so. The
  // screen sends it when the panel was opened on a proposal; an extension
  // composed by hand on the page has no draft and sends nothing. It is an address
  // parameter rather than a body field so that the body stays a pure
  // `ExtendRequest`, as `extendProblem` expects it and as it will be copied into
  // the record.
  const draftId = new URL(request.url).searchParams.get("draft");
  if (draftId) {
    let draft;
    try {
      draft = await loadDraft(draftId);
    } catch (error) {
      if (error instanceof DraftNotFound) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
    // Refused here and not only on screen: the `?extend=<id>` address is shared,
    // and a week-old bookmark does not know the extension has happened.
    const problem = extensionDraftProblem(draft, runId);
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  }

  let detail;
  try {
    detail = await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const problem = extendProblem(
    body,
    detail.run.config.scenarios.length,
    detail.run.config.tools ?? [],
    detail.run.config.turns,
    detail.run.config.models.adversary ?? null,
    detail.run.config.rubric.map((level) => level.value),
    detail.run.config.models.world ?? null,
  );
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  if (detail.run.status === "triggered" || detail.run.status === "running") {
      // Adding cells while the job is running would make it miss them: it read
      // the list of `pending` at its start. They would stay to be done on a run
      // calling itself finished.
    return NextResponse.json(
      { error: "This run is still going. Wait for it to finish." },
      { status: 409 },
    );
  }

  const { added, mode } = await extendRun(runId, body!, user.email, "ui");
  if (added === 0) {
    return NextResponse.json(
      { error: "Nothing to add: that combination is already covered." },
      { status: 409 },
    );
  }

  try {
    await recordStart(runId, await startJob(runId, mode));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  // Marked launched by the route, never by the screen: the gesture belongs to
  // the request that succeeded in extending. The screen used to do it afterwards
  // while swallowing the errors, so that a successful extension and a failed
  // marking silently left a launched draft believing itself still waiting — the
  // exact state closed here. Awaited with no net, as the route that launches a
  // run draft already does: if it falls, the caller must learn of it.
  //
  // One window stays known and deliberately open: between the refusal above and
  // this marking, two concurrent requests carrying the same `?draft=` can both
  // pass the refusal before either marks. Claiming the draft before extending
  // would close that window by opening a worse one: a "launched" marking that
  // would lie about an extension that then fell over. Between the two, this one
  // was chosen.
  if (draftId) await markDraftLaunched(draftId);

  return NextResponse.json({ ok: true, added });
}
