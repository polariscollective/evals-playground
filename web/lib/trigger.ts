// Starting the job that runs a run.
//
// In deployment, the request goes to `polaris-batch-trigger`, a Cloud Run
// service that has the GCP identity Vercel lacks, and which starts the Cloud
// Run Job. In development, without that service, the job is started as a local
// subprocess — the only way to keep the application usable without GCP, and
// without introducing a second form of storage.
import "server-only";
import { spawn } from "node:child_process";

const JOB_NAME = process.env.EVAL_JOB_NAME || "evals-playground-runner";

/** The interpreter that runs the job in development, taken entirely from the
 * environment.
 *
 * No literal path in the code, deliberately: Turbopack analyses `spawn`'s first
 * argument, sees a file to bundle there, and fails on the symbolic link
 * `.venv/bin/python` which points outside its root. Passing it through
 * `EVAL_PYTHON` takes the path out of that analysis — and makes explicit a
 * convenience that only makes sense on a development machine.
 *
 * `.env.example` gives the usual value. */
const LOCAL_PYTHON = "EVAL_PYTHON";

/** `run` plays out the conversations then has them graded by every living
 *  judge of the run. `catchup` fills in, for the conversations already played,
 *  the rows of `judge_scores` still pending — see `run_batch_job`,
 *  `backend/playground/batch_job.py`, the one and only authority on what the
 *  job accepts: making it play `rejudge` or `awareness`, the two former modes
 *  it no longer knows, would fail at the job's startup with a `ValueError`
 *  rather than at compile time — which is exactly the bug this closed type
 *  closes, see `.superpowers/sdd/task-9-report.md`. */
export type JobMode = "run" | "catchup";

/** Where the job ran. Recorded on the run: the local and the deployed write
 * into the same database, and without a marker a throwaway trial looks like a
 * real run. */
export type Origin = "local" | "cloud-run";

export interface Started {
  execution: string;
  origin: Origin;
}

/** Can the local subprocess stand in for the Cloud Run service?
 *
 * Locked on `NODE_ENV` on top of the missing URL, exactly like the
 * authentication short circuit: a variable forgotten on a deployment must not
 * turn a Vercel instance into an execution machine — it has no provider key
 * anyway, and the run would fail on every cell. */
function canRunLocally(): boolean {
  // `EVAL_PYTHON` is the developer's declaration of intent: they want to run
  // the job here. It wins over `BATCH_TRIGGER_URL`, which often stays filled in
  // in a `.env` without anyone wanting to trigger a remote job on every try.
  return (
    process.env.NODE_ENV !== "production" && Boolean(process.env[LOCAL_PYTHON])
  );
}

/** Starts the job as a subprocess, from the repository root.
 *
 * Detached and with no inherited channels: the HTTP request that started it
 * ends straight away, and the job carries on. An attached `spawn` would die
 * with the Next worker on the first hot reload. */
function runLocally(runId: string, mode: JobMode): string {
  const repoRoot = `${process.cwd()}/..`;
  const interpreter = process.env[LOCAL_PYTHON] as string;
  const child = spawn(interpreter, ["-m", "playground.batch_job"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: `${repoRoot}/backend`,
      EVAL_RUN_ID: runId,
      EVAL_JOB_MODE: mode,
    },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return `local:${child.pid}`;
}

/** A variable as one may have pasted it, stripped of what surrounds it.
 *
 * Measured against the real proxy: a space or a newline *at the end* have no
 * effect — the HTTP layer trims a header's edge whitespace. But a space at the
 * start, or quotes left around the value, give a 401 "unauthorized"
 * indistinguishable from a wrong secret. Those two accidents are the ones a
 * copy-paste into an environment-variable interface really produces. */
function pasted(value: string | undefined): string | undefined {
  const clean = value?.trim().replace(/^["']|["']$/g, "");
  return clean || undefined;
}

/** Starts the job, and returns what is needed to find it again.
 *
 * Throws:
 *   The proxy's error, as it stands. A trigger that fails must be visible: the
 *   run then stays `pending` with its message, rather than waiting forever for
 *   a job that never started.
 */
export async function startJob(
  runId: string,
  mode: JobMode = "run",
): Promise<Started> {
  if (canRunLocally()) {
    return { execution: runLocally(runId, mode), origin: "local" };
  }

  const url = pasted(process.env.BATCH_TRIGGER_URL);
  const secret = pasted(process.env.BATCH_TRIGGER_SECRET);
  if (!url || !secret) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "BATCH_TRIGGER_URL and BATCH_TRIGGER_SECRET must both be set."
        : "Set BATCH_TRIGGER_URL to use the deployed trigger, or EVAL_PYTHON to" +
          " run the job locally.",
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job: JOB_NAME,
        env: { EVAL_RUN_ID: runId, EVAL_JOB_MODE: mode },
      }),
      cache: "no-store",
    });
  } catch (error) {
    // An unreachable proxy — DNS, a cold start too long — makes `fetch` fail.
    // Without this guard, the caller would receive Next's HTML error page where
    // it expects JSON, and the error would be unreadable.
    throw new Error(`batch trigger unreachable: ${(error as Error).message}`);
  }

  const body = (await response.json().catch(() => ({}))) as {
    execution?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || `batch trigger returned ${response.status}`);
  }
  return { execution: body.execution ?? "", origin: "cloud-run" };
}
