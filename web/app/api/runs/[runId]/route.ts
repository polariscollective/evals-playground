import { NextResponse } from "next/server";
import { NotFound, loadRun } from "@/lib/runs";

/** Un run et ses cases.
 *
 * `?transcripts=1` ramène les conversations, qui pèsent lourd : le
 * rafraîchissement d'un run en cours s'en passe, l'ouverture d'une case non. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const withTranscripts =
    new URL(request.url).searchParams.get("transcripts") === "1";
  try {
    return NextResponse.json(await loadRun(runId, { withTranscripts }));
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
