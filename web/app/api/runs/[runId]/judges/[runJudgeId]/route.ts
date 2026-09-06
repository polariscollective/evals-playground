import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, PrincipalRequiresReplacement, unlinkJudge } from "@/lib/runs";

/** Délie un juge de ce run : marque sa liaison supprimée, jamais le juge
 *  lui-même — voir `unlinkJudge` (`lib/runs.ts`) pour ce que ça change en
 *  base, et pourquoi c'est une fonction RPC qui le fait en une transaction.
 *
 * `replacement_run_judge_id` : obligatoire seulement pour délier le
 * principal alors qu'il reste d'autres liaisons vivantes sur ce run — la
 * base le refuse sinon (`PrincipalRequiresReplacement`), et c'est voulu.
 * `null` (ou l'absence du champ) délie sans remplaçant, ce qui n'est un
 * problème que dans ce seul cas précis. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ runId: string; runJudgeId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId, runJudgeId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    replacement_run_judge_id?: string | null;
  };

  try {
    await unlinkJudge(runId, runJudgeId, body.replacement_run_judge_id ?? null);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof PrincipalRequiresReplacement) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
