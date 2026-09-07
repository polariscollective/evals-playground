import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  NotFound,
  extendRun,
  failToStart,
  loadRun,
  recordStart,
} from "@/lib/runs";
import { startJob } from "@/lib/trigger";
import { DraftNotFound, loadDraft, markDraftLaunched } from "@/lib/drafts";
import { extendProblem, extensionDraftProblem } from "@/lib/validate";
import type { ExtendRequest } from "@/lib/types";

/** Ajoute une sous-matrice à un run existant : des scénarios, des modèles, des
 * répétitions.
 *
 * Ce que cette route n'accepte pas est aussi important que ce qu'elle accepte :
 * ni critère, ni échelle, ni juge. Un lot jugé autrement ne serait plus
 * comparable au premier, et la matrice n'aurait plus de sens comme matrice. Ce
 * qui ne peut pas être envoyé ne peut pas dériver.
 *
 * La température et le nombre de tours font exception : la première parce qu'elle
 * est portée par chaque case et non par le run, les anciennes gardent donc la
 * leur. Les tours peuvent s'allonger — jamais se raccourcir — et si une case
 * est approfondie, elle est rejugée entière. La profondeur du run reste
 * identique pour toutes ses cases : la comparabilité tient. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as ExtendRequest | null;

  // `?draft=<id>` : cette extension applique un brouillon, et l'appelant le
  // dit. L'écran l'envoie quand le panneau a été ouvert sur une proposition ;
  // une extension composée à la main sur la page n'a pas de brouillon et
  // n'envoie rien. C'est un paramètre d'adresse plutôt qu'un champ du corps
  // pour que celui-ci reste une `ExtendRequest` pure, telle qu'`extendProblem`
  // l'attend et telle qu'elle sera recopiée dans le registre.
  const draftId = new URL(request.url).searchParams.get("draft");
  if (draftId) {
    let draft;
    try {
      draft = await loadDraft(draftId);
    } catch (error) {
      if (error instanceof DraftNotFound) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
    // Refusé ici et pas seulement à l'écran : l'adresse `?extend=<id>` se
    // partage, et un signet vieux d'une semaine ne sait pas que l'extension a
    // eu lieu.
    const problem = extensionDraftProblem(draft, runId);
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
  }

  let detail;
  try {
    detail = await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const problem = extendProblem(
    body,
    detail.run.config.scenarios.length,
    detail.run.config.tools ?? [],
    detail.run.config.turns,
    detail.run.config.models.adversary ?? null,
    detail.run.config.rubric.map((level) => level.value),
  );
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  if (detail.run.status === "triggered" || detail.run.status === "running") {
    // Ajouter des cases pendant que le job tourne les lui ferait manquer : il a
    // lu la liste des `pending` à son démarrage. Elles resteraient à faire sur
    // un run qui se dirait terminé.
    return NextResponse.json(
      { error: "This run is still going. Wait for it to finish." },
      { status: 409 },
    );
  }

  const { added, mode } = await extendRun(runId, body!, user.email, "ui");
  if (added === 0) {
    return NextResponse.json(
      { error: "Nothing to add: that combination is already covered." },
      { status: 409 },
    );
  }

  try {
    await recordStart(runId, await startJob(runId, mode));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  // Marqué lancé par la route, jamais par l'écran : le geste appartient à la
  // requête qui a réussi l'extension. L'écran le faisait après coup en avalant
  // les erreurs, si bien qu'une extension réussie et un marquage tombé
  // laissaient en silence un brouillon lancé qui se croyait en attente — l'état
  // exact qu'on ferme ici. Awaité sans filet, comme le fait déjà la route de
  // lancement d'un brouillon de run : si ça tombe, l'appelant doit l'apprendre.
  //
  // Une fenêtre reste connue et volontairement ouverte : entre le refus plus
  // haut et ce marquage, deux requêtes concurrentes portant le même `?draft=`
  // peuvent toutes deux passer le refus avant que l'une ou l'autre ne marque.
  // Réclamer le brouillon avant d'étendre fermerait cette fenêtre en en
  // ouvrant une pire : un marquage « lancé » qui mentirait sur une extension
  // ensuite tombée. Entre les deux, c'est celle-ci qui a été choisie.
  if (draftId) await markDraftLaunched(draftId);

  return NextResponse.json({ ok: true, added });
}
