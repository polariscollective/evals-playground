import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { ConfigProblem, NotFound, copyRun } from "@/lib/runs";
import type { CopyRequest } from "@/lib/run-copy";

/** Copies this run into a new, independent one: its conversations, grades and
 *  cell costs, whole or reduced to some scenarios, target models, judges and
 *  repetitions. Nothing is replayed and nothing is spent. See `copyRun`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = ((await request.json().catch(() => null)) ?? {}) as CopyRequest & {
    label?: unknown;
  };
  const lists: [keyof CopyRequest, "number" | "string"][] = [
    ["scenario_indices", "number"],
    ["target_models", "string"],
    ["run_judge_ids", "string"],
    ["repetitions", "number"],
  ];
  for (const [key, kind] of lists) {
    const value = body[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== kind))) {
      return NextResponse.json({ error: `${key} must be a list of ${kind}s` }, { status: 422 });
    }
  }
  if (body.label !== undefined && body.label !== null && typeof body.label !== "string") {
    return NextResponse.json({ error: "label must be text" }, { status: 422 });
  }

  try {
    const copy = await copyRun(
      runId,
      {
        scenario_indices: body.scenario_indices,
        target_models: body.target_models,
        run_judge_ids: body.run_judge_ids,
        repetitions: body.repetitions,
      },
      user.email,
      { label: body.label as string | null | undefined, launchedVia: "ui" },
    );
    return NextResponse.json(
      { run_id: copy.runId, scope: copy.scope, money_saved: copy.moneySaved },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ConfigProblem) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
