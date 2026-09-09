import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createExtendDraft } from "@/lib/drafts";
import { NotFound, loadRun } from "@/lib/runs";
import type { ExtendRequest } from "@/lib/types";

/** Setting aside an extension composed by hand, without applying it to the run —
 *  the same gesture as "Save as draft" on the composition form, to enlarge an
 *  existing run rather than launch a new one.
 *
 * No validation, as for a run draft: it is precisely when the proposal is
 * incomplete that one wants to lay it down to come back to it.
 * `submit_draft_extension` validates before depositing, for its part, because an
 * agent must return a launchable proposal — which is not the case here. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as {
    config?: unknown;
  } | null;
  if (!body || typeof body.config !== "object" || body.config === null) {
    return NextResponse.json({ error: "config must be an object" }, { status: 422 });
  }

  try {
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  const id = await createExtendDraft(
    runId,
    body.config as ExtendRequest,
    user.email,
    "manual",
  );
  return NextResponse.json({ id }, { status: 201 });
}
