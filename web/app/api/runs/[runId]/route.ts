import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";

/** Un run et ses cases.
 *
 * `?transcripts=1` ramène les conversations, qui pèsent lourd : le
 * rafraîchissement d'un run en cours s'en passe, l'ouverture d'une case non.
 *
 * `withAwarenessMissingFlag: true` : c'est cette route qui alimente le bouton
 * d'éveil de la page — voir `awarenessMissingTotal` dans `lib/runs.ts` pour
 * pourquoi ce compte n'est demandé qu'ici et sur la route qui lance la passe. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const withTranscripts =
    new URL(request.url).searchParams.get("transcripts") === "1";
  try {
    return NextResponse.json(
      await loadRun(runId, { withTranscripts, withAwarenessMissingFlag: true }),
    );
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
