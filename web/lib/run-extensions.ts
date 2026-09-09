// The history of a run's extensions, with each one's real cost derived.
//
// `eval_runs.extensions` carries only what was known at the time of each
// extension: the request, its quote, and the run's cost just before it applied.
// Nothing in it is ever rewritten after the fact — see the migration
// `evals/supabase/migrations/20260905203414_run_extensions_log.sql`. Each
// extension's real cost is therefore computable, never stored: it is the gap
// between its `cost_before_usd` and the next extension's, or the run's current
// cost for the last.
//
// Pure et calculable, comme `matrix.ts` : la page et un test la lisent pareil.
import type { EvalRun, RunExtensionLogEntry } from "./types";

/** A history entry, augmented with what it actually cost. */
export interface RunExtension extends RunExtensionLogEntry {
  /** `after - cost_before_usd`, `after` being the next extension's
   *  `cost_before_usd` or, for the last, `run.cost_usd`.
   *
   * `null` as soon as either end is missing — never 0, which would wrongly
   * claim a free extension when its cost is simply unknown: a run that has not
   * finished playing since, or one of whose models
   * n'a pas de tarif. */
  actual_cost_usd: number | null;
}

/** The gap between two consolidated costs, or `null` if either is missing. */
function deduct(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return after - before;
}

/** A run's extensions, in the order they were asked for, each with its real
 *  cost derived.
 *
 * Empty on a run that has never been extended. */
export function extensionsOf(run: EvalRun): RunExtension[] {
  return run.extensions.map((entry, index) => {
    const next = run.extensions[index + 1];
    const after = next ? next.cost_before_usd : run.cost_usd;
    return { ...entry, actual_cost_usd: deduct(entry.cost_before_usd, after) };
  });
}
