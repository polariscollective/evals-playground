"use client";

// The drafts list, in exactly the shape of the runs list.
//
// A draft is nothing but a run one has not launched yet: reading it asks for the
// same landmarks — a name, a date, a size, a cost — and two different layouts
// would force the eye to relearn on every toggle. Same columns, same widths,
// same sticky header.
//
// What changes lies in the four middle columns: the date is that of the deposit
// and not of the launch, the shape is the one this draft WILL PRODUCE, the
// status says its nature rather than its progress, and the cost is a quote. The
// last column replaces the mean grade — a draft has had nothing graded — by what
// really decides: can it go?
import Link from "next/link";
import { CopyId } from "@/components/CopyButton";
import { InfoDot } from "@/components/InfoDot";
import { EmptyTable } from "@/components/EmptyTable";
import { TagField } from "@/components/TagField";
import { setDraftTags } from "@/lib/api";
import {
  draftBlocker,
  draftCost,
  draftDestination,
  draftName,
  draftShape,
} from "@/lib/draft-row";
import { PSEUDO_TAG_CLASSES } from "@/lib/run-filters";
import { DimensionIcon } from "@/components/DimensionIcon";
import type { Draft, Tag } from "@/lib/types";

/** A rocket: opening this draft where it can be launched — or, if it has already
 *  served, the run it produced. It launches nothing itself. */
function RocketIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 10c-2 .5-3 2-3.5 4 2-.5 3.5-1.5 4-3.5" />
      <path d="M9.5 12.5 6 9 3.5 6.5C6 3 9 1.5 13 1.5c0 4-1.5 7-4.5 9.5Z" />
      <circle cx="10" cy="5" r="1.2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5 5 13h6l.5-8.5" />
    </svg>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

export function DraftTable({
  drafts,
  draftTags,
  catalog,
  onTagsSaved,
  onDiscard,
  onClear,
  onDefault,
}: {
  drafts: Draft[] | null;
  draftTags: Record<string, Tag[]>;
  catalog: Tag[];
  onTagsSaved: () => Promise<void>;
  onDiscard: (draft: Draft) => void;
  onClear: () => void;
  onDefault: () => void;
}) {
  return (
    <div className="max-h-[70vh] overflow-y-auto">
      <table className="w-full table-fixed text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-zinc-300 text-left text-xs uppercase tracking-wide text-zinc-500">
            <th className="py-3 pr-8 font-medium">Draft</th>
            <th className="w-40 py-3 pr-8 font-medium">Creation</th>
            <th className="relative w-24 py-3 pr-8 font-medium">
              Shape{" "}
              <InfoDot label="What Shape means">
                scenarios × models × repetitions — preceded by a "+" for an
                extension, which adds to the run rather than making a fresh one
              </InfoDot>
            </th>
            <th className="w-32 py-3 pr-8 font-medium">Status</th>
            <th className="w-24 py-3 pr-8 font-medium">Cost</th>
            <th className="relative w-24 py-3 pr-8 font-medium">
              Ready{" "}
              <InfoDot label="What Ready means">
                A draft from the form may be incomplete — that is its reason for
                being. An extension is not judged from here: its quote and its
                validity depend on the run it enlarges.
              </InfoDot>
            </th>
            <th className="w-14 py-3" />
          </tr>
        </thead>
        <tbody>
          {/* The skeleton stays, only the body waits. The columns are known in
              advance: replacing them by a message would make the whole page jump
              at the moment the answer arrives, for a list whose shape was never in
              question. */}
          {drafts === null && (
            <tr>
              <td colSpan={7} className="py-3 text-sm text-zinc-500">
                Loading drafts…
              </td>
            </tr>
          )}
          {drafts !== null && drafts.length === 0 && (
            <tr>
              <td colSpan={7}>
                <EmptyTable onClear={onClear} onDefault={onDefault} />
              </td>
            </tr>
          )}
          {(drafts ?? []).map((draft) => {
            const blocker = draftBlocker(draft);
            const cost = draftCost(draft);
            const launched = draft.launched_at !== null;
            return (
              <tr
                key={draft.id}
                className={`border-b border-zinc-200 align-top hover:bg-zinc-50${
                  // Already launched: present, but visibly out of the queue.
                  launched ? " opacity-60" : ""
                }`}
              >
                <td className="w-full py-3 pr-8">
                  <Link
                    href={draftDestination(draft)}
                    className="run-title inline-block font-medium hover:text-teal-800"
                  >
                    {draftName(draft)}
                  </Link>
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    {/* The identifier is copied: it is what one pastes into an
                        agent so that it takes this draft up again. */}
                    <CopyId value={draft.id} title="Copy draft id" />
                  </div>
                  {/* An extension says nothing of itself: its name is generic, and
                      what really identifies it is the run it enlarges. The link
                      leads there, and the search finds it — see
                      `draftHaystacks`. */}
                  {draft.kind === "extend" && (
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <span>extension of</span>
                      {/* Copied rather than leading to the run: the rocket already
                          goes there, and what one wants from this identifier is to
                          paste it — into an agent, into a note. Two paths to the
                          same page would have been one too many. */}
                      <CopyId
                        value={draft.extends_run_id}
                        title="Copy the extended run's id"
                      />
                    </div>
                  )}
                  <TagField
                    compact
                    tags={draftTags[draft.id] ?? []}
                    catalog={catalog}
                    onSave={(ids) => setDraftTags(draft.id, ids)}
                    onSaved={onTagsSaved}
                  />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <span>{draft.created_by}</span>
                    {/* Both sides are worth as much: knowing a human deposited this
                        draft is information, not an absence of information. The
                        icon says the question, the word says the answer. */}
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        draft.origin === "mcp"
                          ? PSEUDO_TAG_CLASSES.mcp
                          : PSEUDO_TAG_CLASSES.manual
                      }`}
                      title={
                        draft.origin === "mcp"
                          ? "Submitted by an agent — validated on deposit"
                          : "Saved from the form — may be incomplete"
                      }
                    >
                      <DimensionIcon dimension="author" />
                      {draft.origin === "mcp" ? "mcp" : "manual"}
                    </span>
                    {/* "launched" only: waiting is a draft's ordinary state, and
                        the whole queue would carry it. */}
                    {launched && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${PSEUDO_TAG_CLASSES.launched}`}
                        title={`Left the queue on ${formatDate(draft.launched_at!)} — its address stays open`}
                      >
                        <DimensionIcon dimension="launch" />
                        launched
                      </span>
                    )}
                  </div>
                </td>

                <td className="whitespace-nowrap py-3 pr-8 text-zinc-600">
                  {formatDate(draft.created_at)}
                </td>

                <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                  {draftShape(draft)}
                </td>

                <td className="whitespace-nowrap py-3 pr-8">
                  <span
                    className={`inline-flex w-24 items-center justify-center gap-1 rounded px-2 py-0.5 text-xs ${
                      draft.kind === "extend"
                        ? PSEUDO_TAG_CLASSES.extend
                        : PSEUDO_TAG_CLASSES.creation
                    }`}
                    title={
                      draft.kind === "extend"
                        ? "Enlarges an existing run"
                        : "Proposes a fresh run"
                    }
                  >
                    <DimensionIcon dimension="kind" />
                    {draft.kind === "extend" ? "extend" : "creation"}
                  </span>
                </td>

                <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                  {cost === null ? (
                    <span
                      className="text-zinc-400"
                      title={
                        draft.kind === "extend"
                          ? "An extension's quote depends on the run it enlarges — it reads on that run's page."
                          : "Not costable while the configuration is incomplete."
                      }
                    >
                      —
                    </span>
                  ) : (
                    `~$${cost.toFixed(cost < 1 ? 3 : 2)}`
                  )}
                </td>

                <td className="py-3 pr-8 text-xs">
                  {/* An icon and not the sentence: a slightly long validation
                      reason tripled its row's height and deformed the whole table.
                      The whole reason opens on click, where it no longer costs
                      anybody anything. */}
                  {blocker === undefined ? (
                    <span
                      className="text-zinc-400"
                      title="Its validity depends on the run it enlarges."
                    >
                      —
                    </span>
                  ) : blocker === null ? (
                    <span className="text-teal-700" title="Ready to launch">
                      ✓
                    </span>
                  ) : (
                    <InfoDot
                      label="Why this draft cannot launch"
                      glyph="⚠"
                      tone="text-amber-700 hover:text-amber-900"
                    >
                      {blocker}
                    </InfoDot>
                  )}
                </td>

                <td className="py-3 align-middle">
                  <div className="flex items-center justify-end gap-1">
                    {/* The rocket launches nothing: it opens where one can launch,
                        after rereading. A draft often comes from an agent, and
                        spending on a click in a list would be a trap. */}
                    <Link
                      href={draftDestination(draft)}
                      title={
                        launched
                          ? draft.kind === "extend"
                            ? "See what this extension did"
                            : "Show the produced run"
                          : draft.kind === "extend"
                            ? "Open the run to apply this extension"
                            : "Open the form to reread it and launch it"
                      }
                      aria-label={
                        launched
                          ? draft.kind === "extend"
                            ? "See what this extension did"
                            : "Show the produced run"
                          : "Open to launch"
                      }
                      // A new tab: one is going through a queue, and opening a
                      // draft must not cost the list one was reading. `noopener`
                      // because `_blank` without it gives the opened page a handle
                      // on this one.
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-full p-1 text-zinc-300 hover:text-teal-700"
                    >
                      <RocketIcon />
                    </Link>
                    <button
                      type="button"
                      onClick={() => onDiscard(draft)}
                      title="Discard this draft"
                      aria-label={`Discard draft ${draftName(draft)}`}
                      className="rounded p-1 text-zinc-300 hover:bg-red-100 hover:text-red-800"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
