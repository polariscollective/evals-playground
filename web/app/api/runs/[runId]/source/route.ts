import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { sourceCsv } from "@/lib/runs";
import { csvResponse } from "@/lib/csv-response";

/** The CSV uploaded at launch, as it stands.
 *
 * A 404 for the runs typed in by hand or launched before that file was kept: it
 * is an absence, not a breakdown, and the interface offers the link only when it
 * exists. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const content = await sourceCsv(runId);
  if (content === null) {
    return NextResponse.json(
      { error: "No source CSV was kept for this run." },
      { status: 404 },
    );
  }
  return csvResponse(content, `source-${runId}.csv`);
}
