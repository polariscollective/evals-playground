import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { estimateCost } from "@/lib/pricing";
import { ConfigProblem, reusedJudges } from "@/lib/runs";
import { settleReusedJudges } from "@/lib/judge-reuse";
import { configProblem } from "@/lib/validate";
import type { WrittenRunConfig } from "@/lib/types";

/** Estimates a run's cost without launching anything.
 *
 * The same input schema as the launch: the interface therefore estimates exactly
 * what it is about to send, with no intermediate transformation liable to
 * diverge. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const config = (await request.json().catch(() => null)) as WrittenRunConfig | null;

  const problem = configProblem(config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  // A judge NAMED rather than described is settled here, exactly as `createRun`
  // settles it: the quote then prices the question that will really go out,
  // rather than counting a judge with no question at all. Same reads, same
  // refusals — a handle nothing answers to is a 422 here too, which is how the
  // form learns of it before the launch button is pressed.
  let settled: WrittenRunConfig = config!;
  try {
    settled = settleReusedJudges(config!, await reusedJudges(config!));
  } catch (error) {
    if (error instanceof ConfigProblem) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  // The assumed length is in the config, like the rest: a query parameter on the
  // side allowed estimating something other than what one was about to launch.
  return NextResponse.json(estimateCost(settled));
}
