import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { sourceCsv } from "@/lib/runs";
import { csvResponse } from "@/lib/csv-response";

/** Le CSV téléversé au lancement, tel quel.
 *
 * Un 404 pour les runs saisis à la main ou lancés avant que ce fichier ne soit
 * conservé : c'est une absence, pas une panne, et l'interface ne propose le
 * lien que lorsqu'il existe. */
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
