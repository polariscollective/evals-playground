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
import { extendProblem } from "@/lib/validate";
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

  const added = await extendRun(runId, body!);
  if (added === 0) {
    return NextResponse.json(
      { error: "Nothing to add: that combination is already covered." },
      { status: 409 },
    );
  }

  try {
    await recordStart(runId, await startJob(runId, "run"));
  } catch (error) {
    const reason = `Could not start the job: ${(error as Error).message}`;
    await failToStart(runId, reason);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true, added });
}
