import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { estimateCost } from "@/lib/pricing";
import { configProblem } from "@/lib/validate";
import type { EvalRunConfig } from "@/lib/types";

/** Estimates a run's cost without launching anything.
 *
 * The same input schema as the launch: the interface therefore estimates exactly
 * what it is about to send, with no intermediate transformation liable to
 * diverge. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const config = (await request.json().catch(() => null)) as EvalRunConfig | null;

  const problem = configProblem(config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  // The assumed length is in the config, like the rest: a query parameter on the
  // side allowed estimating something other than what one was about to launch.
  return NextResponse.json(estimateCost(config!));
}
