"use client";

/** The judge library, kept in memory for the whole visit.
 *
 * The same pattern as the four other caches, and for the same reason: this list
 * moves when a run is launched or a judge is unlinked, which is rare next to how
 * often one looks at it. The bar warms it while you read another page, so the
 * tab opens on what is already there.
 *
 * See `store.ts` for the mechanism.
 */

import { useSyncExternalStore } from "react";
import { listJudges } from "./api";
import { createResource } from "./store";
import type { JudgeSummary } from "./types";

const judges = createResource<JudgeSummary[]>(listJudges);

export const refreshJudges = judges.refresh;
export const ensureJudgesLoaded = judges.ensureLoaded;

export function useJudges(): {
  data: JudgeSummary[] | null;
  loading: boolean;
  error: string | null;
} {
  const state = useSyncExternalStore(
    judges.subscribe,
    judges.get,
    judges.getInitial,
  );
  return { data: state.data, loading: state.loading, error: state.error };
}
