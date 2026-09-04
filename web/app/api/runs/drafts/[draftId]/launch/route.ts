import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { DraftNotFound, loadDraft, markDraftLaunched } from "@/lib/drafts";
import { createRun, failToStart, recordStart } from "@/lib/runs";
import { setRunTags, tagsOfDraft } from "@/lib/tags";
import { startJob } from "@/lib/trigger";
import { configProblem } from "@/lib/validate";

/** Lance un brouillon : le même chemin que `POST /api/runs`, config et auteur
 *  près, mais tirés du brouillon plutôt que du corps de la requête. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  let draft;
  try {
    draft = await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const problem = configProblem(draft.config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  const run = await createRun(draft.config, user.email, draft.csv_text);
  try {
    await recordStart(run.id, await startJob(run.id, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(run.id, reason);
    return NextResponse.json({ run_id: run.id, error: reason }, { status: 502 });
  }
  // Recopier les tags maintenant : le run existe et tourne, et le brouillon
  // est encore lisible — après markDraftLaunched ce ne serait pas plus
  // dangereux ici, mais autant rester du bon côté de la frontière. Un échec
  // ici ne doit pas faire échouer la réponse : le run est déjà lancé, le
  // signaler en erreur mentirait à l'appelant sur ce qui a réussi. On
  // journalise donc plutôt que de relancer l'erreur.
  try {
    const tags = await tagsOfDraft(draftId);
    if (tags.length > 0) {
      await setRunTags(run.id, tags.map((tag) => tag.id));
    }
  } catch (error) {
    console.error(`Could not copy tags from draft ${draftId} to run ${run.id}:`, (error as Error).message);
  }

  // Marqué lancé, pas effacé : il sort de la liste d'attente, garde son
  // adresse ouverte pour un relancement, et dit désormais ce qu'il a produit.
  await markDraftLaunched(draftId, run.id);
  return NextResponse.json({ run_id: run.id }, { status: 201 });
}
