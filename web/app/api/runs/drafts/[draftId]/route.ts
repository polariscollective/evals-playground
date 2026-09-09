import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  DraftNotFound,
  discardDraft,
  loadDraft,
  markDraftLaunched,
  updateDraftOwned,
} from "@/lib/drafts";
import type { EvalRunConfig, ExtendRequest } from "@/lib/types";

/** A draft's content, so that the form or the extension panel opens prefilled
 *  on it.
 *
 * Guarded like the other `/api` routes: a draft carries the configuration an
 * agent submitted, not public content.
 *
 * `mine` is added to the draft itself: the browser never knows the current
 * user's address — only the route ties it to the session — and therefore cannot
 * compare `created_by` by itself. It is that verdict a button reads to announce
 * itself as "Save as my own copy" before writing, rather than discovering it
 * afterwards in a redirection. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  try {
      // The whole draft: the kind is part of it, and the caller cannot read its
      // payload without knowing how to read it.
    const draft = await loadDraft(draftId);
    return NextResponse.json({ ...draft, mine: draft.created_by === user.email });
  } catch (error) {
    if (error instanceof DraftNotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }
}

/** Discarding a draft: the bin.
 *
 * It leaves the list and its address stops answering — that is what distinguishes
 * it from a launched draft. Nothing is erased for all that.
 *
 * Silent on a draft already discarded: two tabs making the same gesture must not
 * produce an error on the second. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  await discardDraft(draftId);
  return NextResponse.json({ ok: true });
}

/** The two ways of taking a draft back in hand.
 *
 * `launched`: it has served. It leaves the waiting list without being discarded —
 * its address stays open, and what it produced is read on the run, which carries
 * `draft_id`.
 *
 * `config`: it is rewritten — in place for its author, replacing rather than
 * sowing a second one, without which the waiting list would accumulate
 * duplicates among which nobody could tell which is the right one. But for
 * anyone else, the rewrite lays a new draft instead: the original is untouched,
 * exactly the rule the MCP tool `update_draft_run` already applies —
 * `updateDraftOwned` carries it for both rather than repeating it here in
 * another form. `forked` says so in the response, so that the screen navigates
 * to the right address instead of suggesting it was still editing the original.
 *
 * No validation on the second: a manual draft has the right to be incomplete,
 * which is even its reason for being. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { draftId } = await params;
  const body = (await request.json().catch(() => null)) as {
    launched?: unknown;
    config?: unknown;
    csv_text?: unknown;
  } | null;

  if (body?.launched === true) {
    await markDraftLaunched(draftId);
    return NextResponse.json({ ok: true });
  }

  if (body && typeof body.config === "object" && body.config !== null) {
    try {
      const draft = await loadDraft(draftId);
      const result = await updateDraftOwned(
        draft,
        body.config as EvalRunConfig | ExtendRequest,
        typeof body.csv_text === "string" ? body.csv_text : null,
        user.email,
      );
      return NextResponse.json({
        ok: true,
        forked: result.forked,
        draft_id: result.draftId,
      });
    } catch (error) {
      if (error instanceof DraftNotFound) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }
  }

  return NextResponse.json(
    { error: "send either launched: true or config" },
    { status: 422 },
  );
}
