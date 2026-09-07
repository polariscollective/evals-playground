import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";

/** Un run et ses cases, plus ses juges vivants et leurs verdicts.
 *
 * `?transcripts=1` ramène les conversations ET les verdicts complets de TOUS
 * les juges vivants — les deux pèsent pour la même raison et se demandent
 * toujours ensemble : voir `attachJudges` dans `lib/runs.ts`. Sans ce
 * paramètre, seuls les verdicts du juge PRINCIPAL et de l'éventuelle liaison
 * d'éveil sont ramenés — ce que la matrice et son voyant affichent sans
 * qu'on déplie rien ; le rafraîchissement d'un run en cours s'en contente.
 *
 * `?full_judges=1` ramène, lui aussi, les verdicts complets de tous les juges
 * vivants, mais sans les conversations : c'est ce que demande l'écran dès
 * qu'on regarde un juge secondaire (voir `app/eval/[runId]/page.tsx`), pour
 * ne pas payer le poids des transcripts au seul motif de changer de juge
 * affiché — voir `withFullJudgeScores` sur `loadRun` (`lib/runs.ts`).
 *
 * `withJudges: true` : c'est elle qui fait exister `detail.judges` — voir
 * `components/RunRead.tsx`, écrit contre ce contrat avant que cette route ne
 * le pose réellement.
 *
 * `withCatchupMissingFlag: true` : c'est cette route qui alimente le bouton
 * de rattrapage de la page — voir `catchupMissingTotal` dans `lib/runs.ts`
 * pour pourquoi ce compte n'est demandé qu'ici et sur la route qui lance la
 * passe. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const withTranscripts = searchParams.get("transcripts") === "1";
  const withFullJudgeScores = searchParams.get("full_judges") === "1";
  try {
    return NextResponse.json(
      await loadRun(runId, {
        withTranscripts,
        withJudges: true,
        withCatchupMissingFlag: true,
        withFullJudgeScores,
        // Le voyant des résultats servis, et son croisement avec l'éveil. Une
        // lecture de plus par ouverture de run, sur une table le plus souvent
        // vide — c'est la page du run, pas la liste, qui la paie.
        withToolResults: true,
      }),
    );
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}
