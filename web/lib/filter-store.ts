"use client";

/** The filter state of each list, shared by the page and kept from one visit
 *  to the next.
 *
 * A store rather than a `useState` for a precise reason: the value lives in
 * `localStorage`, which the server does not know. Reading it on the first
 * render would make the HTML rendered on the server diverge from the one
 * rendered on the client. `useSyncExternalStore` handles that case by name — it
 * returns the server snapshot during hydration, then switches to the real one —
 * where an effect setting the state after the fact would cost one more render
 * and a
 * avertissement de React.
 */

import { useSyncExternalStore } from "react";
import {
  defaultState,
  readState,
  writeState,
  type FilterMode,
} from "./filter-storage";
import { createStore } from "./store";
import {
  OPEN,
  cycleDimension,
  toggleOff,
  type DimensionKey,
  type FilterState,
} from "./run-filters";

/** Constant references: `useSyncExternalStore` compares snapshots by identity,
 *  and a fresh object at every call would loop the render. */
const SERVER: Record<FilterMode, { state: FilterState }> = {
  runs: { state: defaultState("runs") },
  drafts: { state: defaultState("drafts") },
};

const stores = {
  runs: createStore(SERVER.runs),
  drafts: createStore(SERVER.drafts),
};

/** `localStorage` is read once per list, on the first request. */
const loaded: Record<FilterMode, boolean> = { runs: false, drafts: false };

function snapshot(mode: FilterMode): { state: FilterState } {
  if (!loaded[mode]) {
    loaded[mode] = true;
    stores[mode].set({ state: readState(mode) });
  }
  return stores[mode].get();
}

function commit(mode: FilterMode, next: FilterState): void {
  stores[mode].set({ state: next });
  writeState(mode, next);
}

/** Rotates a dimension button: one side, the other, both. */
export function cycleDim(mode: FilterMode, key: DimensionKey): void {
  commit(mode, cycleDimension(stores[mode].get().state, key));
}

/** Show everything: no dimension collapsed, no tag switched off.
 *
 * Distinct from the gesture below, and it is the distinction that counts. "Show
 * everything" and "go back to the starting settings" do not give the same
 * screen: the defaults deliberately hide agent runs and drafts already
 * launched. A single button for both would have made a choice look like an
 * absence of choice. */
export function clearFilters(mode: FilterMode): void {
  commit(mode, OPEN);
}

/** Go back to the starting settings — the ones the page chooses to apply on
 *  the first visit. */
export function defaultFilters(mode: FilterMode): void {
  commit(mode, defaultState(mode));
}

/** Switches a tag, or a status, on or off. */
export function toggleTag(mode: FilterMode, label: string): void {
  commit(mode, toggleOff(stores[mode].get().state, label));
}

export function useFilterState(mode: FilterMode): FilterState {
  return useSyncExternalStore(
    stores[mode].subscribe,
    () => snapshot(mode),
    () => SERVER[mode],
  ).state;
}
