"use client";

// The filter bar, and the toggle between the two lists.
//
// Two very different gestures live side by side there, hence two button shapes.
//
// A DIMENSION cycles: one click moves from "both" to the notable side, then to
// the other, then back. Its icon never changes — it is what says which question
// is at stake — and only the word changes. Open, it is pale and says "both":
// nothing is filtered, and the button does not pretend to act.
//
// A TAG or a STATUS turns on and off. Off, it is struck through: something has
// been taken away from it, which does not read as a choice between two.
import { DimensionIcon } from "@/components/DimensionIcon";
import { colorClasses } from "@/lib/tag-colors";
import {
  DIMENSIONS,
  PSEUDO_TAG_CLASSES,
  OPEN,
  STATUS_LABELS,
  choiceOf,
  sameFilter,
  sideLabel,
  type DimensionKey,
  type FilterState,
} from "@/lib/run-filters";
import type { Tag } from "@/lib/types";

const PILL = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs";
/** A dashed outline, with no ground: the state in which the button filters
 *  nothing. */
const OPEN_PILL = `${PILL} border border-dashed border-zinc-300 text-zinc-500 hover:text-zinc-800`;

function DimensionButton({
  dimension,
  state,
  onCycle,
}: {
  dimension: DimensionKey;
  state: FilterState;
  onCycle: () => void;
}) {
  const choice = choiceOf(state, dimension);
  const { a, b } = DIMENSIONS[dimension];
  const open = choice === "both";
  const word = open ? "both" : sideLabel(dimension, choice);

  return (
    <button
      type="button"
      onClick={onCycle}
      title={
        open
          ? `Showing both — click to see only ${a}`
          : choice === "a"
            ? `Showing only ${a} — click to see only ${b}`
            : `Showing only ${b} — click to see both`
      }
      aria-label={`${a} or ${b}: currently ${word}`}
      className={open ? OPEN_PILL : `${PILL} ${PSEUDO_TAG_CLASSES[word] ?? ""}`}
    >
      <DimensionIcon dimension={dimension} />
      {word}
    </button>
  );
}

export function FilterBar({
  mode,
  onMode,
  dims,
  statuses,
  tags,
  catalog,
  state,
  onCycle,
  onToggle,
  onClear,
  onDefault,
  defaults,
  query,
  onQuery,
  hidden,
}: {
  mode: "runs" | "drafts";
  onMode: (next: "runs" | "drafts") => void;
  dims: DimensionKey[];
  statuses: string[];
  tags: string[];
  catalog: Tag[];
  state: FilterState;
  onCycle: (key: DimensionKey) => void;
  onToggle: (label: string) => void;
  /** Show everything. */
  onClear: () => void;
  /** Go back to the starting settings. */
  onDefault: () => void;
  /** This list's starting settings, so as to know whether one is already there. */
  defaults: FilterState;
  /** The search under way. Deliberately outside the saved state: a filter is a
   *  preference, a search is a gesture — finding it as it stands on return would
   *  be disconcerting. It holds for both lists, and therefore follows the
   *  toggle. */
  query: string;
  onQuery: (next: string) => void;
  /** How many rows the filter sets aside, to say so rather than letting one
   *  believe the database is empty. */
  hidden: number;
}) {
  const off = new Set(state.off);
  // A link that would change nothing goes dark rather than promising a gesture
  // with no effect: "clear" when nothing is filtered, "default" when one is
  // already at the starting setting.
  const cleared = sameFilter(state, OPEN);
  const atDefault = sameFilter(state, defaults);
  const LINK = "text-xs link-underline";
  const LIVE = `${LINK} text-zinc-500 hover:text-zinc-900`;
  const DEAD = `${LINK} cursor-default text-zinc-300`;

  return (
    <div className="space-y-2">
      {/* The toggle replaces the old "Show drafts" button: they are not two
          sections one of which opens, but two lists one looks at one or the other
          of. A switch says it better than a button. */}
      <div className="flex items-center gap-3">
      <div className="inline-flex rounded-full border border-zinc-300 p-0.5 text-xs">
        {(["runs", "drafts"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onMode(value)}
            aria-pressed={mode === value}
            className={`rounded-full px-3 py-1 capitalize ${
              mode === value
                ? "bg-olive-deep text-paper"
                : "text-zinc-500 hover:text-zinc-900"
            }`}
          >
            {value}
          </button>
        ))}
      </div>
      {/* Two gestures, because they do not give the same screen: "clear" opens
          everything, "default" goes back to what the page chooses to hide at first
          sight — the agent runs, the drafts already launched. Confusing them would
          make a choice pass for an absence of choice.

          Always present, even when nothing departs from them: their place is part
          of the bar, and links that appeared and disappeared would move the toggle
          beside them. */}
      <button
        type="button"
        onClick={onClear}
        disabled={cleared}
        title={
          cleared
            ? "Nothing is filtered"
            : "Show everything — no dimension reduced, no tag hidden"
        }
        className={cleared ? DEAD : LIVE}
      >
        clear filters
      </button>
      <button
        type="button"
        onClick={onDefault}
        disabled={atDefault}
        title={
          atDefault
            ? "Already at the default filters"
            : "Back to what this list shows on a first visit"
        }
        className={atDefault ? DEAD : LIVE}
      >
        default filters
      </button>
      </div>

      {(dims.length > 0 || statuses.length > 0 || tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">Show</span>

          {dims.map((key) => (
            <DimensionButton
              key={key}
              dimension={key}
              state={state}
              onCycle={() => onCycle(key)}
            />
          ))}

          {/* A rule between the dimensions and the sets: the two are not clicked
              the same way, and nothing else would say so. */}
          {dims.length > 0 && (statuses.length > 0 || tags.length > 0) && (
            <span aria-hidden="true" className="h-4 w-px bg-zinc-300" />
          )}

          {[statuses, tags].map((groupe, index) =>
            groupe.length === 0 ? null : (
              <div key={index} className="flex flex-wrap items-center gap-2">
                {index === 1 && statuses.length > 0 && (
                  <span aria-hidden="true" className="h-4 w-px bg-zinc-300" />
                )}
                {groupe.map((label) => {
                  const on = !off.has(label);
                  const couleur =
                    PSEUDO_TAG_CLASSES[label] ??
                    colorClasses(
                      catalog.find((tag) => tag.label === label)?.color ?? "",
                    );
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => onToggle(label)}
                      aria-pressed={on}
                      title={
                        on
                          ? `Hide ${STATUS_LABELS[label] ?? label}`
                          : `Show ${STATUS_LABELS[label] ?? label}`
                      }
                      className={
                        on
                          ? `rounded-full px-2 py-0.5 text-xs ${couleur}`
                          : "rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs text-zinc-400 line-through hover:text-zinc-600"
                      }
                    >
                      {STATUS_LABELS[label] ?? label}
                    </button>
                  );
                })}
              </div>
            ),
          )}

          {hidden > 0 && (
            <span className="text-xs text-zinc-500">{hidden} hidden</span>
          )}
        </div>
      )}

      {/* Below the filters, and not beside them: it is not one more filter but a
          way of aiming at a row whose name or identifier one already knows. It
          applies to the list one is looking at, whichever it is. */}
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={`Search ${mode} by name or id…`}
          aria-label={`Search ${mode}`}
          className="w-80 max-w-full border border-zinc-300 px-3 py-1 text-sm"
        />
        {query !== "" && (
          <button
            type="button"
            onClick={() => onQuery("")}
            className="text-xs link-underline"
          >
            clear search
          </button>
        )}
      </div>
    </div>
  );
}
