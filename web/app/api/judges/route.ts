import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { loadJudgeSummaries } from "@/lib/judges";

/** One line per judge, for the cache the bar warms while you read another page.
 *
 * Summaries only. The criterion is a paragraph and the uses are a row per run;
 * carrying both for every judge made this payload grow with the library rather
 * than with what is on screen. A row asks for its own detail when it opens. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await loadJudgeSummaries());
}
