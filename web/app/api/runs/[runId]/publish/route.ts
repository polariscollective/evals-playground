import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun, setPublic } from "@/lib/runs";
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
    public?: unknown;
  } | null;
  if (typeof body?.public !== "boolean") {
    return NextResponse.json(
      { error: "public must be true or false" },
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

  await setPublic(runId, body.public);
  return NextResponse.json({
    ok: true,
    url: body.public ? publicRunPath(runId) : null,
  });
}
