"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  discardDraft,
  publishRun,
  getDrafts,
  getMe,
  setRunTags,
  softDeleteRun,
} from "@/lib/api";
import { formatMean, formatValue, rubricBounds } from "@/lib/rubric";
import { CopyId, PublicIcon } from "@/components/CopyButton";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { TagField } from "@/components/TagField";
import { Refreshing } from "@/components/Loading";
import { InfoDot } from "@/components/InfoDot";
import { RunTitle } from "@/components/RunTitle";
import { DraftTable } from "@/components/DraftTable";
import {
  PSEUDO_TAG_CLASSES,
  STATUS_LABELS,
  draftSides,
  offered,
  passes,
  matchesQuery,
  runSides,
} from "@/lib/run-filters";
import type { DimensionKey } from "@/lib/run-filters";
import {
  clearFilters,
  cycleDim,
  defaultFilters,
  toggleTag,
  useFilterState,
} from "@/lib/filter-store";
import { FilterBar } from "@/components/FilterBar";
import { defaultState } from "@/lib/filter-storage";
import { EmptyTable } from "@/components/EmptyTable";
import { draftHaystacks, draftName } from "@/lib/draft-row";
import { DimensionIcon } from "@/components/DimensionIcon";
import type { FilterMode } from "@/lib/filter-storage";
import type { Draft } from "@/lib/types";
import { forgetRun, refreshRuns, useRuns } from "@/lib/runs-store";
import { refreshTags, useTags } from "@/lib/tags-store";

const STATUS_STYLE: Record<string, string> = {
  triggered: "bg-zinc-100 text-zinc-700",
  running: "bg-teal-100 text-teal-900",
  done: "bg-olive-deep text-paper",
  error: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-900",
};

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



/** A bin, discreet until hover: the gesture is rare and reversible, it has no
 *  business weighing on the page. */
function TrashIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4" />
    </svg>
  );
}

/** The waiting drafts — what an agent has proposed, not launched yet.
 *
 * Opening one leads to the evaluation form prefilled, not to a reading screen:
 * what one wants to do with a draft is reread it, correct it and launch it. A
 * launched draft disappears from here — without which one would no longer know
 * which is left to do.
 *
 * Whoever it belongs to: a draft is a proposal made to the team. */
/** The button that reopens the list to the drafts already launched. Taken out of
 *  the heading so that it goes on counting what is waiting, and not what is
 *  displayed. */


export default function RunsPage() {
  // The list comes from the shared store, no longer from a local state: that is
  // what makes a return to this tab find the rows already read instead of
  // starting again from an empty screen. See `lib/runs-store.ts`.
  const { runs, loading, error: runsError } = useRuns();
  const [error, setError] = useState<string | null>(null);
  // The drafts are only loaded on demand: most of the time there is none, and one
  // more request on every opening of the runs list would be paid for nothing.
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  // Which list one is looking at. The toggle above the filters replaces the old
  // "Show drafts" button: they are not two sections one of which opens, but two
  // lists one looks at one or the other of. It replaces the table, and each mode
  // has its filter bar and its saved preference — see `filter-storage.ts`.
  const mode: FilterMode = showDrafts ? "drafts" : "runs";
  const filterState = useFilterState(mode);
  const [me, setMe] = useState<string | null>(null);
  // The tags come from the shared store, like the list: they are tiny but cost
  // two round trips on every visit, and the pills arrived half a second after
  // their rows.
  const { catalog: tagCatalog, assignments: tagAssignments } = useTags();
  // Mine by default: the database is shared, and everybody's list buries one's
  // own within a few weeks. What one is looking for on opening this page is
  // almost always a run one launched oneself.
  const [mineOnly, setMineOnly] = useState(true);
  // What is waiting to be confirmed: a run, a draft, or nothing.
  const [confirming, setConfirming] = useState<
    { kind: "run"; id: string; label: string } | { kind: "draft"; draft: Draft } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  /** What one is looking for. In the state and not in `localStorage`: a filter is
   *  a preference, a search is a gesture. Shared by both lists — typing a word
   *  then switching searches for the same word on the other side. */
  const [query, setQuery] = useState("");
  /** The run one is about to publish, or `null`. Separate from `confirming`:
   *  publishing and discarding have neither the same dialogue nor the same
   *  tone. */
  const [confirmingPublish, setConfirmingPublish] = useState<
    { id: string; label: string; next: boolean } | null
  >(null);
  /** The identifier of the run whose publication is in flight, so as to turn off
   *  its button only — not the other thirteen. */
  const [publishing, setPublishing] = useState<string | null>(null);

  // On every arrival at the tab: we check again, indicator lit. The rows already
  // in cache stay displayed meanwhile — that is the whole point, one does not
  // start again from an empty screen to find the same thing.
  useEffect(() => {
    const timer = setTimeout(() => void refreshRuns(), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
      // Without it, "mine" means nothing: we fall back on everything, which is
      // the behaviour from before rather than an empty list.
    getMe()
      .then(({ email }) => setMe(email))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refreshTags(), 0);
    return () => clearTimeout(timer);
  }, []);

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    try {
      if (confirming.kind === "run") {
        await softDeleteRun(confirming.id);
        forgetRun(confirming.id);
      } else {
        await discardDraft(confirming.draft.id);
        setDrafts((current) =>
          (current ?? []).filter((draft) => draft.id !== confirming.draft.id),
        );
      }
      setConfirming(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  /** Publish or unpublish, then read the list again. Silent: the button already
   *  says it is working, and a second indicator at the top of the page would say
   *  nothing more. */
  const setPublished = async (runId: string, next: boolean) => {
    setPublishing(runId);
    try {
      await publishRun(runId, next);
      await refreshRuns({ silent: true });
      setConfirmingPublish(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishing(null);
    }
  };

  /* The drafts are always loaded whole, launched ones included, and it is the
     filter that sets them aside. The old "Show launched" button redid the
     request; having become a button of the bar, it can no longer: a label only
     shows there if a row carries it, and none would carry it as long as the
     request excluded them. The button would never appear.

     They are counted in dozens: bringing everything back costs less than one
     more request on every toggle. The load itself is in the effect just
     above. */

  // The load follows the state, it does not depend on the gesture that changed
  // it. Hooked to the button's handler alone, it did not start if the page opened
  // on the drafts already — and the list stayed on "Loading…" forever.
  useEffect(() => {
    if (!showDrafts || drafts !== null) return;
      // `alive`: the response can arrive after one has left the page, and writing
      // into an unmounted component serves nobody.
    let alive = true;
    getDrafts(true)
      .then((loaded) => {
        if (alive) setDrafts(loaded);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [showDrafts, drafts]);

  // As long as a run is going, the list refreshes: it is the only place from
  // which one can follow several runs at once.
  useEffect(() => {
    if (!runs?.some((r) => r.run.status === "running" || r.run.status === "triggered"))
      return;
    // Silent: a running run makes this request beat every three seconds, and it
    // must make nothing flicker.
    const timer = setInterval(() => void refreshRuns({ silent: true }), 3000);
    return () => clearInterval(timer);
  }, [runs]);

  const shownError = error ?? runsError;
  if (shownError) {
    return (
      <main className="mx-auto max-w-6xl p-8">
        <p
          role="alert"
          className="rounded border border-red-400 bg-red-50 p-3 text-red-800"
        >
          {shownError}
        </p>
      </main>
    );
  }

  // The filter only applies if one knows who is looking: with no identity,
  // hiding everything would give an empty page with no explanation.
  const mine = mineOnly && me !== null;
  // `?? []`: in drafts mode, the runs list may not have arrived yet — the guard
  // above no longer waits for it in that case.
  const loaded = runs ?? [];
  const runsInScope = mine
    ? loaded.filter((entry) => entry.run.user_email === me)
    : loaded;
  const draftsInScope =
    drafts === null ? [] : mine ? drafts.filter((d) => d.created_by === me) : drafts;

  // What each row is, and what it carries: two distinct things, and two ways of
  // filtering. See `run-filters.ts`.
  const runRows = runsInScope.map((entry) => ({
    entry,
    sides: runSides(entry.run),
    labels: [
      entry.run.status,
      ...(tagAssignments.runs[entry.run.id] ?? []).map((tag) => tag.label),
    ],
  }));
  const draftRows = draftsInScope.map((draft) => ({
    draft,
    sides: draftSides(draft),
    labels: (tagAssignments.drafts[draft.id] ?? []).map((tag) => tag.label),
  }));

  // The bar offers only what the CURRENT list carries, and is computed before
  // filtering — otherwise narrowing a dimension would make its own button
  // disappear and there would be no way left to reopen it.
  const bar = offered(mode, mode === "drafts" ? draftRows : runRows);

  const runsSeen = runRows
    .filter(
      (row) =>
        passes(row.sides, row.labels, filterState) &&
        matchesQuery(
          [row.entry.run.label, row.entry.run.first_scenario_title, row.entry.run.id],
          query,
        ),
    )
    .map((row) => row.entry);
  const draftsSeen = draftRows
    .filter(
      (row) =>
        passes(row.sides, row.labels, filterState) &&
        matchesQuery(draftHaystacks(row.draft), query),
    )
    .map((row) => row.draft);
  const hiddenCount =
    mode === "drafts"
      ? draftRows.length - draftsSeen.length
      : runRows.length - runsSeen.length;

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl tracking-tight">Runs</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-zinc-600">
            {showDrafts
              ? "Everything waiting to be launched, newest first. Open one to review it."
              : "Every evaluation run, most recent first. Open one to see its matrix."}
            {/* Only lights up over a list already displayed: when there is still
                nothing to read, it is "Loading…" that speaks, and two messages
                would say the same thing. */}
            {loading && runs !== null && <Refreshing />}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setMineOnly(!mineOnly)}
            disabled={me === null}
            title={
              me === null
                ? "Could not tell who you are — showing everything"
                : `Yours: ${me}`
            }
            className={`rounded-full border px-3 py-1.5 text-sm disabled:opacity-40 ${
                mine
                ? "border-zinc-900 bg-olive-deep text-paper"
                : "border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            Show mine only
          </button>
        </div>
      </header>

      <FilterBar
        mode={mode}
        onMode={(next) => setShowDrafts(next === "drafts")}
        dims={bar.dims}
        statuses={bar.statuses}
        tags={bar.tags}
        catalog={tagCatalog}
        state={filterState}
        onCycle={(key: DimensionKey) => cycleDim(mode, key)}
        onToggle={(label: string) => toggleTag(mode, label)}
        onClear={() => clearFilters(mode)}
        onDefault={() => defaultFilters(mode)}
        defaults={defaultState(mode)}
        query={query}
        onQuery={setQuery}
          hidden={hiddenCount}
      />

      {showDrafts ? (
        <DraftTable
            drafts={drafts === null ? null : draftsSeen}
          draftTags={tagAssignments.drafts}
          catalog={tagCatalog}
          onTagsSaved={refreshTags}
          onDiscard={(draft) => setConfirming({ kind: "draft", draft })}
          onClear={() => clearFilters(mode)}
          onDefault={() => defaultFilters(mode)}
        />
      ) : (
          /* `table-fixed` and not the automatic computation: without it, each
              column sizes itself on its content, and filtering the list — or
              simply a run with a longer title — redistributes the whole width.
              The columns jumped from one state to the next.

              The widths are therefore laid once, as tightly as possible: "Run"
              has none and absorbs what is left, and it is indeed the one that
              must stretch since it carries the title, the identifier and the
              tags. Squeeze the others too much and the identifier wraps.

              They are identical to those of the drafts table, column by column:
              without that, switching from one list to the other shifted
              everything by a few pixels, and the eye saw it without knowing
              what. */
          /* The list scrolls inside its own frame rather than in the page, and
             its header sticks to it: over forty runs, one lost the column names
             after three rows.

             `max-h-[70vh]` and not a fixed height — the filter bar above changes
             height with the number of tags, and a frozen frame would overflow
             the screen on the small ones.

             With no border: the rule under the header and those between the rows
             already say where the list begins and ends. */
        <div className="max-h-[70vh] overflow-y-auto">
        <table className="w-full table-fixed text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            {/* Every column aligned left, figures included. The cost and the grade
                were on the right — the usage for numbers — but only two columns
                out of seven were, and the eye going down the table stumbled on
                them. A consistent table is worth more here than a typographic
                convention applied twice. */}
            <tr className="border-b border-olive text-left text-xs font-semibold text-zinc-500">
              <th className="py-3 pr-8 font-medium">Run</th>
              <th className="w-40 py-3 pr-8 font-medium">Launched</th>
              <th className="relative w-24 py-3 pr-8 font-medium">
                Shape{" "}
                <InfoDot label="What Shape means">
                  scenarios × models × repetitions
                </InfoDot>
              </th>
              <th className="w-32 py-3 pr-8 font-medium">Status</th>
              <th className="w-24 py-3 pr-8 font-medium">Cost</th>
              <th className="w-24 py-3 pr-8 font-medium">Grade</th>
              <th className="w-14 py-3" />
            </tr>
          </thead>
          <tbody>
            {/* The skeleton stays, even empty: the columns said the table's width,
                and replacing them by a message made it shrink — then reopen as
                soon as a filter was undone.

                And "not loaded yet" is not "empty": offering to undo the filters
                while the request is in flight would accuse the filter of a screen
                nobody has filled in yet. */}
            {runs === null && (
              <tr>
                <td colSpan={7} className="py-6 text-sm text-zinc-500">
                  Loading…
                </td>
              </tr>
            )}
            {runs !== null && runsSeen.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyTable
                    onClear={() => clearFilters(mode)}
                    onDefault={() => defaultFilters(mode)}
                  />
                </td>
              </tr>
            )}
            {runsSeen.map(({ run, progress, mean, repetitions }) => {
              const { max } = rubricBounds(run.rubric);
              const running =
                run.status === "running" || run.status === "triggered";
              const [low, high] = repetitions;
              return (
                <tr
                  key={run.id}
                  className="border-b border-zinc-200 align-top hover:bg-zinc-50"
                >
                  {/* The title column takes the space left: it is by the title that
                      one finds a run again, not by its shape or its status. */}
                  <td className="w-full py-3 pr-8">
                    <RunTitle
                      runId={run.id}
                      label={run.label}
                      fallback={run.first_scenario_title ?? run.id}
                      onSaved={() => void refreshRuns({ silent: true })}
                    >
                      <Link
                        href={`/eval/${run.id}`}
                        className="run-title inline-block font-medium hover:text-teal-800"
                      >
                        {run.label ?? run.first_scenario_title ?? run.id}
                      </Link>
                    </RunTitle>
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <CopyId value={run.id} />
                    {/* The local and the deployed write into the same database:
                        without this badge, a throwaway trial looks like a real run.
                        Only the local is marked — it is the exception. */}
                    </div>
                    <TagField
                      compact
                      tags={tagAssignments.runs[run.id] ?? []}
                      catalog={tagCatalog}
                      onSave={(ids) => setRunTags(run.id, ids)}
                      onSaved={refreshTags}
                    />
                  {/* Who launched it. Everybody sees every run: without the
                      author, a loaded list no longer says whom to ask when a run
                      surprises.

                      And by what: "(MCP)" says an agent pressed the button, not a
                      human. Only THIS run's launch is counted — a draft written by
                      an agent then launched by a click stays a human launch, and
                      what is added to a run afterwards creates no run. Nothing for
                      "ui": the ordinary case has no business carrying a label. */}
                  {/* "local" and "MCP" live on the address line: all three say who
                      launched this run and from where, while the row above says
                      what it IS. "public" stays up there — it is a button that
                      copies the link, not a label. The classes come from
                      `run-filters.ts`, shared with the filter bar's buttons. */}
                    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      {run.user_email && <span>{run.user_email}</span>}
                    {/* "local" only: "live" is the ordinary case, and labelling it
                        would amount to marking everybody. "MCP" and "manual", on
                        the other hand, are worth as much as each other — knowing a
                        human launched it is information, not an absence of
                        information. */}
                      {run.origin === "local" && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${PSEUDO_TAG_CLASSES.local}`}
                          title="Ran on a development machine, not on the deployed job"
                        >
                          <DimensionIcon dimension="machine" />
                          local
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                          run.launched_via === "mcp"
                            ? PSEUDO_TAG_CLASSES.mcp
                            : PSEUDO_TAG_CLASSES.manual
                        }`}
                        title={
                          run.launched_via === "mcp"
                            ? "Launched by an agent through MCP"
                            : "Launched by hand from this application"
                        }
                      >
                        <DimensionIcon dimension="author" />
                        {run.launched_via === "mcp" ? "mcp" : "manual"}
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-600">
                    {formatDate(run.created_at)}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                    {run.scenario_count} ×{" "}
                    {run.target_count} ×{" "}
                    {/* Counted on the cells: a completed run no longer has the same
                        number of attempts everywhere, and `config.repetitions`
                        would say only what was asked for the last batch. */}
                    {low === high ? low : `${low}–${high}`}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8">
                    <span
                      /* Every badge at the width of the longest, "cancelled", and
                         the word centred inside it: otherwise the column has five
                         different widths and the eye can no longer go down it in
                         one stroke. */
                      className={`inline-block w-20 rounded px-2 py-0.5 text-center text-xs ${STATUS_STYLE[run.status] ?? ""}`}
                    >
                      {STATUS_LABELS[run.status] ?? run.status}
                    </span>
                    {running && (
                      <div className="text-xs text-zinc-500">
                        {progress.done + progress.errored} / {progress.total}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-8 text-zinc-700">
                    {run.cost_usd === null
                      ? "—"
                      : `$${run.cost_usd.toFixed(run.cost_usd < 1 ? 3 : 2)}`}
                  </td>
                  {/* The mean carries its scale: each run has its own, and a bare
                      figure would wrongly compare from one row to the next. */}
                  <td className="whitespace-nowrap py-3 pr-8">
                    {mean === null ? (
                      <span className="text-zinc-400">—</span>
                    ) : (
                      <>
                        <span className="font-medium">{formatMean(mean)}</span>
                        <span className="text-xs text-zinc-500">
                          {" "}
                          / {formatValue(max)}
                        </span>
                      </>
                    )}
                  </td>
                  {/* Nothing is erased: the run leaves the lists and public
                      reading, its row stays in the database. */}
                  {/* `align-middle` against the row's `align-top`: a row has four
                      levels — title, identifier, tags, address — and two icons
                      hooked at the top of that height attach visually to nothing.
                      In the middle, they belong to the whole row. */}
                  <td className="py-3 align-middle">
                    {/* A flex, and not two inline buttons: the column is narrow and
                        they stacked one under the other. */}
                    <div className="flex items-center justify-end gap-1">
                    {/* Both directions ask for confirmation. Publishing exposes
                        scenarios, conversations and justifications to whoever has
                        the link. Unpublishing has a consequence just as real facing
                        it: a link already shared stops answering, with no warning
                        to whoever holds it. */}
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmingPublish({
                          id: run.id,
                          label: run.label ?? run.first_scenario_title ?? run.id,
                          next: !run.is_public,
                        })
                      }
                      disabled={publishing === run.id}
                      title={run.is_public ? "Published — click to unpublish" : "Not published — click to publish"}
                      aria-label={run.is_public ? `Unpublish run ${run.label ?? run.id}` : `Publish run ${run.label ?? run.id}`}
                      aria-pressed={run.is_public}
                      className={
                        run.is_public
                          ? `rounded-full p-1 disabled:opacity-40 ${PSEUDO_TAG_CLASSES.public}`
                          : "rounded-full p-1 text-zinc-300 hover:text-zinc-600 disabled:opacity-40"
                      }
                    >
                      <PublicIcon />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirming({
                          kind: "run",
                          id: run.id,
                          label:
                            run.label ?? run.first_scenario_title ?? run.id,
                        })
                      }
                      title="Remove this run from the lists"
                      aria-label={`Remove run ${run.label ?? run.id}`}
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
      )}
      <ConfirmDialog
        open={confirmingPublish !== null}
        title={
          confirmingPublish?.next ? "Publish this run?" : "Unpublish this run?"
        }
        confirmLabel={confirmingPublish?.next ? "Publish" : "Unpublish"}
        tone={confirmingPublish?.next ? "neutral" : "warning"}
        busy={publishing !== null}
        onConfirm={() =>
          confirmingPublish &&
          void setPublished(confirmingPublish.id, confirmingPublish.next)
        }
        onCancel={() => setConfirmingPublish(null)}
      >
        {confirmingPublish?.next ? (
          <p className="text-sm">
            Anyone with the link will be able to read{" "}
            <strong>{confirmingPublish?.label}</strong> without signing in —
            scores, judge justifications, full conversations and the scenarios
            themselves. The link is not listed anywhere, and unpublishing kills
            it.
          </p>
        ) : (
          <p className="text-sm">
            The public link to <strong>{confirmingPublish?.label}</strong> will
            stop answering — for everyone, including the Inspect logs served
            under it. Nobody holding that link is told; it simply stops working.
            Publishing again mints the same address, but anything open on it
            right now breaks.
          </p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.kind === "draft" ? "Discard this draft?" : "Remove this run?"
        }
        confirmLabel={confirming?.kind === "draft" ? "Discard" : "Remove"}
        tone="warning"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setConfirming(null)}
      >
        <p className="text-sm">
          <strong className="font-medium">
            {confirming?.kind === "draft"
              ? draftName(confirming.draft)
              : (confirming?.label ?? "")}
          </strong>{" "}
          {confirming?.kind === "draft"
            ? "leaves the waiting list, and its link stops answering."
            : "leaves the lists, and its public link — if it had one — stops answering."}
        </p>
        {/* Saying it explicitly: without this, a bin reads as an erasure, and one
            hesitates to use it. */}
        <p className="text-sm text-zinc-500">
          Nothing is erased. The row stays in the database, so this can be
          undone by hand if it was a mistake.
        </p>
      </ConfirmDialog>
    </main>
  );
}
