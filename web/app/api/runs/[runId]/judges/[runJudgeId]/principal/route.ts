import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, designatePrincipal } from "@/lib/runs";

/** Désigne le principal de ce run : le juge que la matrice affiche — voir
 *  `designatePrincipal` (`lib/runs.ts`).
 *
 * Sans corps : l'adresse porte déjà toute l'information. Idempotent —
 * désigner un juge déjà principal ne réécrit rien. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string; runJudgeId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId, runJudgeId } = await params;
  try {
    await designatePrincipal(runId, runJudgeId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
