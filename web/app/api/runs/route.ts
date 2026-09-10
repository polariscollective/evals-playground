import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  ConfigProblem,
  createRun,
  failToStart,
  loadRunList,
  recordStart,
} from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";
import type { WrittenRunConfig } from "@/lib/types";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  // The list, not the whole runs: see `loadRunList` and `RunListRun`. The MCP
  // search, for its part, keeps going through `loadRuns`.
  return NextResponse.json(await loadRunList());
}

/** Creates a run, writes its whole matrix pending, then starts the job.
 *
 * In that order: the run exists in the database before anything runs, so that a
 * failed trigger leaves a visible trace rather than a silence. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    config?: WrittenRunConfig;
    csv_text?: string | null;
    draft_id?: string | null;
  } | null;

  const problem = configProblem(body?.config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  // The author comes from the session, never from what the client claims. The
  // original draft, for its part, can only come from the client: it is the client
  // that knows what the form was open on, and getting it wrong only attributes a
  // provenance, never a right.
  // The judges a configuration NAMES are resolved inside `createRun`, which is
  // where the database is: a handle nothing answers to comes back as the same
  // 422 as a fault `configProblem` could see on its own.
  let run;
  try {
    run = await createRun(
      body!.config!,
      user.email,
      body?.csv_text ?? null,
      body?.draft_id ?? null,
    );
  } catch (error) {
    if (error instanceof ConfigProblem) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  try {
    await recordStart(run.id, await startJob(run.id, "run"));
  } catch (error) {
      // Without this, the run would stay pending until the expiry function picked
      // it up two hours later, with a message speaking of a job that had vanished
      // rather than of a job never launched.
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(run.id, reason);
    return NextResponse.json({ run_id: run.id, error: reason }, { status: 502 });
  }

  return NextResponse.json({ run_id: run.id }, { status: 201 });
}
