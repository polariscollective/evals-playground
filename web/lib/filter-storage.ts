"use client";

/** The filter state, from one visit to the next, and separately per list.
 *
 * Two keys, because they are two bars: runs are filtered by machine,
 * publication, author; drafts by what belongs to them alone. A single state for
 * both would let a collapse set on the drafts survive the return to the runs,
 * where it means nothing.
 *
 * `localStorage` and not `sessionStorage`: this is a preference, not a browsing
 * state. Somebody who wants to see only their agent runs means it for good.
 * Unlike the caches in `store.ts`, which must start again from zero so as never
 * to show yesterday's data.
 *
 * The keys carry a version suffix: the stored shape went from a list of
 * switched-off labels to an object, and reading the old one as the new would
 * have returned an empty state without anyone understanding why. A fresh key
 * lets the old one die of its own accord.
 *
 * Every read and every write is guarded: a browser in private browsing, or set
 * to refuse site storage, makes the access itself throw. A lost preference must
 * not break the page.
 */

import { DIMENSION_KEYS, OPEN, type DimensionKey, type FilterState, type Side } from "./run-filters";

export type FilterMode = "runs" | "drafts";

const KEYS: Record<FilterMode, string> = {
  runs: "evals-playground:runs-filter-v2",
  drafts: "evals-playground:drafts-filter-v2",
};

/** The starting state of each list.
 *
 * On the runs side, `author: "b"` — only what a human launched: agent runs are
 * many and rarely what one comes looking for. On the drafts side,
 * `launch: "b"` — only what is waiting, the queue being made for that. An
 * agent's draft, for its part, is precisely what one comes to see: the author
 * stays open on that side. */
const DEFAULTS: Record<FilterMode, FilterState> = {
  runs: { dims: { author: "b" }, off: [] },
  drafts: { dims: { launch: "b" }, off: [] },
};

export function defaultState(mode: FilterMode): FilterState {
  return DEFAULTS[mode];
}

/** Reads back what was written, distrusting everything: a value from an
 *  earlier version, or typed by hand, must not bring the list down. */
function parse(raw: unknown, mode: FilterMode): FilterState {
  if (!raw || typeof raw !== "object") return DEFAULTS[mode];
  const source = raw as { dims?: unknown; off?: unknown };

  const dims: Partial<Record<DimensionKey, Side>> = {};
  if (source.dims && typeof source.dims === "object") {
    const given = source.dims as Record<string, unknown>;
    for (const key of DIMENSION_KEYS) {
      const side = given[key];
      if (side === "a" || side === "b") dims[key] = side;
    }
  }

  const off = Array.isArray(source.off)
    ? source.off.filter((entry): entry is string => typeof entry === "string")
    : [];

  return { dims, off };
}

export function readState(mode: FilterMode): FilterState {
  try {
    const raw = window.localStorage.getItem(KEYS[mode]);
    if (raw === null) return DEFAULTS[mode];
    return parse(JSON.parse(raw), mode);
  } catch {
    return DEFAULTS[mode];
  }
}

export function writeState(mode: FilterMode, state: FilterState): void {
  try {
    window.localStorage.setItem(KEYS[mode], JSON.stringify(state));
  } catch {
    // The setting will not survive the visit. That is all that is lost.
  }
}

export { OPEN };
