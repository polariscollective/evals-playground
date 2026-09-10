import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { loadJudge } from "@/lib/judges";

/** One judge, whole. Asked for when a row is opened, never before: the list
 *  deliberately carries no criterion and no list of runs. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ judgeId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const detail = await loadJudge((await params).judgeId);
  if (!detail) {
    return NextResponse.json({ error: "Unknown judge" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
