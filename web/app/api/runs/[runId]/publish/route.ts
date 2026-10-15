import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, setVisibility } from "@/lib/runs";
import { isVisibility, type Visibility } from "@/lib/visibility";
import { publicRunPath } from "@/lib/run-id";

/** Publishing a run, or unpublishing it.
 *
 * Guarded like every `/api` route: it is a user's gesture, not a public read.
 * What it opens, on the other hand, is not — `/shared/<id>` answers outside a
 * session, and that is the whole point.
 *
 * Returns the public address when the run has just been published, `null`
 * otherwise: the client then has nothing to build or to guess. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as {
    visibility?: unknown;
    public?: unknown;
  } | null;
  // `visibility` is private, restricted or public; `public` (true or false)
  // is the older form, still understood.
  let visibility: Visibility;
  if (isVisibility(body?.visibility)) visibility = body.visibility;
  else if (typeof body?.public === "boolean") visibility = body.public ? "public" : "private";
  else {
    return NextResponse.json(
      { error: "visibility must be private, restricted or public" },
      { status: 422 },
    );
  }

  try {
      // Check existence first: a PostgREST PATCH on an unknown identifier
      // touches no row and answers 204, which would read as a successful
      // publication.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  await setVisibility(runId, visibility);
  return NextResponse.json({
    ok: true,
    visibility,
    // The shared address answers for a public run, and for a restricted one
    // once its reader signs in.
    url: visibility === "private" ? null : publicRunPath(runId),
  });
}
