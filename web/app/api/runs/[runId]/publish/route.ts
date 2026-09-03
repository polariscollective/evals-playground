import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, setPublic } from "@/lib/runs";

/** Publier un run, ou le dépublier.
 *
 * Gardée comme toutes les routes `/api` : c'est un geste d'utilisateur, pas une
 * lecture publique. Ce qu'elle ouvre, en revanche, ne l'est pas — `/shared/<id>`
 * répond hors session, et c'est tout l'objet.
 *
 * Rend l'adresse publique quand le run vient d'être publié, `null` sinon : le
 * client n'a alors rien à fabriquer ni à deviner. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as {
    public?: unknown;
  } | null;
  if (typeof body?.public !== "boolean") {
    return NextResponse.json(
      { error: "public must be true or false" },
      { status: 422 },
    );
  }

  try {
    // Vérifier l'existence d'abord : un PATCH PostgREST sur un identifiant
    // inconnu ne touche aucune ligne et répond 204, ce qui se lirait comme une
    // publication réussie.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  await setPublic(runId, body.public);
  return NextResponse.json({
    ok: true,
    url: body.public ? `/shared/${runId}` : null,
  });
}
