// A run submitted in YAML by the MCP tool submit_draft_run, saved without
// being launched — the gesture of launching stays a human click, on the page
// createDraft makes addressable.
import "server-only";
import { DRAFTS, DRAFT_TAGS, NOW, insert, remove, rpc, select, update } from "./supabase";
import type {
  Draft,
  EvalRunConfig,
  ExtendRequest,
  WrittenRunConfig,
} from "./types";

export class DraftNotFound extends Error {}

export type { Draft };

/** Recording a draft.
 *
 * `origin` is asked for rather than guessed: it is what says, on reopening it,
 * whether an incomplete configuration is an anomaly or the normal state of the
 * work. The MCP tool only deposits the valid — it validates first — where the
 * form deposits what it has to hand. */
/** Proposing to enlarge a run, without touching it.
 *
 * Nothing is applied to the run: neither the models, nor the scenarios, nor the
 * tools the request proposes to add. The draft carries only an intention, and
 * it is the extension panel that carries it out after confirmation — a draft
 * one throws away must leave the run exactly as it was. */
export async function createExtendDraft(
  runId: string,
  request: ExtendRequest,
  createdBy: string,
  origin: "manual" | "mcp",
): Promise<string> {
  const rows = await insert<Draft>(
    DRAFTS,
    {
      kind: "extend",
      extends_run_id: runId,
      config: request,
      csv_text: null,
      created_by: createdBy,
      origin,
    },
    { returning: true },
  );
  return rows[0].id;
}

export async function createDraft(
  config: WrittenRunConfig,
  csvText: string | null,
  createdBy: string,
  origin: "manual" | "mcp",
): Promise<string> {
  const rows = await insert<Draft>(
    DRAFTS,
    { kind: "run", config, csv_text: csvText, created_by: createdBy, origin },
    { returning: true },
  );
  return rows[0].id;
}

let lastSweep = 0;

/** Erases the forgotten drafts before any read — same pattern as
 *  `failStaleRuns`, with a wider interval: an abandoned draft is not urgent to
 *  pick up. */
async function sweepStaleDrafts(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  try {
    await rpc("sweep_stale_eval_run_drafts");
  } catch (error) {
    console.error("sweep_stale_eval_run_drafts:", (error as Error).message);
  }
}

/** Throws: DraftNotFound if no draft carries this identifier. */
export async function loadDraft(id: string): Promise<Draft> {
  await sweepStaleDrafts();
  // A launched draft stays openable — one may want to relaunch the same thing.
  // A discarded draft does not: it alone disappears from this read.
  const rows = await select<Draft>(DRAFTS, {
    id: `eq.${id}`,
    select: "*",
    deleted_at: "is.null",
    limit: 1,
  });
  const draft = rows[0];
  if (!draft) throw new DraftNotFound(`Unknown draft: ${id}`);
  return draft;
}

/** Every waiting draft, from the most recent to the oldest.
 *
 * With no filter on the author: a draft is a proposal made to the team, as a
 * run is once launched — everyone sees everything.
 *
 * `withLaunched` reopens the list to those that have already served. They leave
 * it by default because the waiting list is made for what is waiting; but they
 * keep their address, and relaunching the same thing is an expected gesture —
 * provided one can find them again. The discarded ones never come back. */
export async function loadDrafts(
  options: { withLaunched?: boolean } = {},
): Promise<Draft[]> {
  await sweepStaleDrafts();
  return select<Draft>(DRAFTS, {
    select: "*",
    deleted_at: "is.null",
    ...(options.withLaunched ? {} : { launched_at: "is.null" }),
    order: "created_at.desc",
  });
}

/** Rewriting a draft in place, from the form.
 *
 * Reopening a draft, correcting it and saving it must replace it, not sow a
 * second one: the waiting list does not want duplicates among which nobody
 * could tell which is the right one.
 *
 * It goes back to `manual`, even if it came from an agent. The pill does not
 * say who created it but whether its content has been validated:
 * `submit_draft_run` deposits only the valid, and that guarantee falls as soon
 * as a hand rewrites the configuration without going through it. Keeping `mcp`
 * would make the pill lie precisely where it is useful — in front of an
 * incomplete draft, deciding whether it is an anomaly or work under way. The
 * original provenance is lost; that is the price, and it said less than the
 * guarantee.
 *
 * Hence the parameter rather than a constant: `update_draft_run` validates
 * before writing, exactly like `submit_draft_run`, and the guarantee therefore
 * still holds after it has passed. The default stays `manual` — it is the form
 * that calls most often, and it is the form that guarantees nothing.
 *
 * `config` carries an `EvalRunConfig` for a run draft, an `ExtendRequest` for
 * an extension draft — the same column in the database takes both, and it is
 * the caller that knows which one it is rewriting. */
export async function updateDraft(
  id: string,
  config: WrittenRunConfig | ExtendRequest,
  csvText: string | null,
  origin: "manual" | "mcp" = "manual",
): Promise<void> {
  await update(
    DRAFTS,
    { config, csv_text: csvText, origin },
    { id: `eq.${id}` },
  );
}

/** What a write that respects a draft's ownership did: rewritten in place, or
 *  laid down separately. */
export interface DraftWriteResult {
  /** `true` if the write created a new draft rather than rewriting the one
   *  aimed at — because whoever writes is not its author. */
  forked: boolean;
  /** The address to read next: the one that was passed if `forked` is false, a
   *  new one otherwise. */
  draftId: string;
}

/** Rewriting a draft while respecting its ownership — the same rule the MCP
 *  tool `update_draft_run` applies, made to be called by both rather than
 *  rewritten a second time in another way.
 *
 * Its author sees it rewritten in place, replacing rather than sowing a second
 * one. Anyone else receives a new draft carrying their proposal, in their name;
 * the original is untouched. `forked` says so, so that the caller knows where
 * to send whoever asked — a silent redirection would let them believe they were
 * still editing the original.
 *
 * `csvText` is worth something only for a run draft: an extension never carries
 * one, whatever the caller passes here. */
export async function updateDraftOwned(
  draft: Draft,
  config: WrittenRunConfig | ExtendRequest,
  csvText: string | null,
  requestedBy: string,
  origin: "manual" | "mcp" = "manual",
): Promise<DraftWriteResult> {
  const effectiveCsv = draft.kind === "run" ? csvText : null;

  if (draft.created_by === requestedBy) {
    await updateDraft(draft.id, config, effectiveCsv, origin);
    return { forked: false, draftId: draft.id };
  }

  const draftId =
    draft.kind === "run"
      ? await createDraft(config as EvalRunConfig, effectiveCsv, requestedBy, origin)
      : await createExtendDraft(
          draft.extends_run_id,
          config as ExtendRequest,
          requestedBy,
          origin,
        );
  return { forked: true, draftId };
}

/** Discarding a draft: it leaves the list, and its address no longer answers.
 *
 * Its tag links are withdrawn afterwards: a tag survives only carried by
 * something alive, and a discarded draft no longer is. That is what keeps
 * "detached everywhere = deleted" true even for what goes to the bin — the
 * `delete_orphan_tag` trigger deletes the tag if that link was the last one.
 *
 * `deleted_at` first, the withdrawal afterwards: if the latter fails, the draft
 * stays discarded with its tags still attached, with no consequence — the
 * reverse would detach the tags of a draft which, if the following deletion
 * failed, would not even be discarded. */
export async function discardDraft(id: string): Promise<void> {
  await update(DRAFTS, { deleted_at: NOW }, { id: `eq.${id}` });
  await remove(DRAFT_TAGS, { draft_id: `eq.${id}` });
}

/** Marking a draft as launched.
 *
 * It leaves the waiting list — it has served — but its address stays open:
 * reopening a launched draft to relaunch the same thing is a legitimate
 * gesture, and `launched_at` therefore says the *last* launch.
 *
 * What it produced is no longer recorded here. A single cell cannot hold
 * several runs, and the second launch was erasing the first: it is
 * `eval_runs.draft_id` that carries the link, as many times as needed. */
export async function markDraftLaunched(id: string): Promise<void> {
  await update(DRAFTS, { launched_at: NOW }, { id: `eq.${id}` });
}
