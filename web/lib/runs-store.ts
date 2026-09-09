"use client";

/** The list of runs, kept in memory for the whole visit.
 *
 * Without it, every visit to the "Runs" tab started from an empty screen and a
 * request: you arrived on "Evaluate", clicked "Runs", and waited in front of
 * "Loading…" for a list you had already seen ten seconds earlier. The content
 * nonetheless almost never moves between two clicks.
 *
 * A module store rather than a React context: the runs page is not the only
 * one that triggers the load — "Evaluate" preloads it on arrival, so that the
 * next tab is already filled when it opens. A context would have imposed a
 * provider in `layout.tsx` for a state nobody changes outside this file.
 *
 * The mechanism is in `store.ts`, shared with the three other caches.
 */

import { useSyncExternalStore } from "react";
import { getRuns } from "./api";
import { createResource } from "./store";
import type { RunListItem } from "./types";

const runs = createResource(getRuns);

export const refreshRuns = runs.refresh;
export const ensureRunsLoaded = runs.ensureLoaded;

/** Removes a run from the cache after it goes to the bin, with no round trip.
 *  Without it, the deleted row would reappear on the first return to the tab. */
export function forgetRun(runId: string): void {
  const current = runs.get().data;
  if (current === null) return;
  runs.set(current.filter((entry) => entry.run.id !== runId));
}

export function useRuns(): {
  runs: RunListItem[] | null;
  loading: boolean;
  error: string | null;
} {
  const state = useSyncExternalStore(runs.subscribe, runs.get, runs.getInitial);
  return { runs: state.data, loading: state.loading, error: state.error };
}
