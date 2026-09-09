// How many attempts of a run carry each level of the scale — what the extension
// panel shows beside each grade one can choose to deepen.
//
// Counted from the attempts the page already has in memory, never from a
// separate request: keeping them up to date would be the page's work, not that
// of one more round trip for a question its data already answers. A level
// nobody carries must come out at zero — without which ticking it would send a
// request that would deepen nothing.
//
// Since the multiple judges, an attempt's grade is no longer the
// `eval_samples.score` column (dropped by the migration
// `20260906093000_drop_eval_samples_score_columns.sql`, polaris-supabase
// repository): it is the `judge_scores` row of the PRINCIPAL judge on that
// attempt — the only one this panel deepens, exactly like the matrix it
// prolongs (see « La matrice suit le principal »,
// docs/superpowers/specs/2026-09-06-juges-multiples.md). The caller joins
// `EvalSample` and `judge_scores` before arriving here; this module reads
// neither table.
import { addEstimates, estimateDeepening } from "./pricing.ts";
import type {
  CostEstimate,
  EvalRunConfig,
  JudgeScore,
  LengthAssumption,
  RubricLevel,
  SampleStatus,
} from "./types";

/** The status and the grade of the principal judge on an attempt, reduced to
 *  what this module uses of them — same drawing as `JudgeVerdict` in
 *  `awareness.ts`, redefined here rather than imported: this file has nothing to
 *  do with awareness, and has no business depending on it for so small a
 *  shape. */
export type PrincipalVerdict = Pick<JudgeScore, "status" | "score">;

/** An attempt as these counts see it: the model that played it, the status of
 *  its execution, and the principal judge's verdict — never another judge that
 *  has not been deleted. */
export interface DeepenSample {
  target_model: string;
  status: SampleStatus;
  principal: PrincipalVerdict;
}

/** `DeepenSample`, plus what is needed to group afterwards by model and by
 *  starting depth (see `groupByModelAndDepth`) — a count has no need to know
 *  `turns_done`, but `samplesForSelection` must make it travel with the attempt
 *  so that `extendRun` can group what it has just read from the database the
 *  same way the panel groups what it already has in memory. */
export interface DeepenSampleWithDepth extends DeepenSample {
  turns_done: number | null;
}

/** How many attempts, in total and split by target model.
 *
 * The split by model serves the quote: `estimateDeepening` returns a fair price
 * only for one tariff at a time (see its comment in `pricing.ts`), and a choice
 * of attempts straddling several models is costed by calling it once per model,
 * with its own count. */
export interface DeepenCount {
  total: number;
  byModel: Record<string, number>;
}

function emptyCount(): DeepenCount {
  return { total: 0, byModel: {} };
}

function record(count: DeepenCount, model: string): void {
  count.total += 1;
  count.byModel[model] = (count.byModel[model] ?? 0) + 1;
}

/** Is an attempt graded by the principal: its conversation is played, and the
 *  principal gave it a grade — whichever one, `excluded` included (see
 *  `countsByLevel`). It equally matters little *why* there is none: pending,
 *  fallen over, empty conversation or grade off the scale all read as "no
 *  attempt to pick up at this level yet", exactly as before the grade came to
 *  live in its own table. */
function isGraded(sample: DeepenSample): boolean {
  return sample.status === "done" && sample.principal.score !== null;
}

/** One count per level, in the order `rubric` gives them.
 *
 * An attempt counts for its level even if that level is `excluded`: deepening an
 * attempt judged "not applicable" means the same as for any other — only the
 * mean sets it aside, not the list of attempts one can pick up. */
export function countsByLevel(
  samples: DeepenSample[],
  rubric: RubricLevel[],
): DeepenCount[] {
  return rubric.map((level) => {
    const count = emptyCount();
    for (const sample of samples) {
      if (sample.status === "done" && sample.principal.score === level.value) {
        record(count, sample.target_model);
      }
    }
    return count;
  });
}

/** Every attempt of the run graded by the principal, whatever its level — what
 *  `deepen: "all"` covers. */
export function countAllGraded(samples: DeepenSample[]): DeepenCount {
  const count = emptyCount();
  for (const sample of samples) {
    if (isGraded(sample)) record(count, sample.target_model);
  }
  return count;
}

/** The count for a selection as the panel builds it: `"all"` for every graded
 *  attempt, a list of grades to take only the attempts carrying them, `null` to
 *  deepen none. */
export function countsForSelection(
  samples: DeepenSample[],
  selection: "all" | number[] | null,
): DeepenCount {
  if (selection === null) return emptyCount();
  if (selection === "all") return countAllGraded(samples);
  const values = new Set(selection);
  const count = emptyCount();
  for (const sample of samples) {
    if (
      sample.status === "done" &&
      sample.principal.score !== null &&
      values.has(sample.principal.score)
    ) {
      record(count, sample.target_model);
    }
  }
  return count;
}

/** The attempts a selection keeps, in the order `samples` gives them — same
 *  filter as `countsForSelection`, but the attempts themselves rather than
 *  their count, `turns_done` included: that is what is needed to group them
 *  afterwards by starting depth (see `groupByModelAndDepth`) — a count per
 *  model no longer carries that information. */
export function samplesForSelection(
  samples: DeepenSampleWithDepth[],
  selection: "all" | number[] | null,
): DeepenSampleWithDepth[] {
  if (selection === null) return [];
  if (selection === "all") {
    return samples.filter(isGraded);
  }
  const values = new Set(selection);
  return samples.filter(
    (sample) =>
      sample.status === "done" &&
      sample.principal.score !== null &&
      values.has(sample.principal.score),
  );
}

/** An attempt to deepen, reduced to the two fields that fix its price: the
 *  model that plays it, and the depth it sets off from. An `EvalSample`
 *  satisfies this shape without conversion; so does a row read from the
 *  database — only `target_model` and `turns_done` asked for. */
export interface DeepenCell {
  target_model: string;
  turns_done: number | null;
}

/** A group of attempts that share the model playing them and the depth they set
 *  off from — the only granularity at which `estimateDeepening` returns a fair
 *  price (see its comment in `pricing.ts`). */
export interface DeepenGroup {
  target_model: string;
  turns_done: number;
  cells: number;
}

/** Groups attempts to deepen by (target model, starting depth) pair — and not
 *  by the model alone, which was enough before a run could be deepened more than
 *  once. Since then, the attempts already pushed are deeper than the ones left
 *  behind, and an `"all"` — or a list of grades covering both groups — would mix
 *  them into one count if one grouped on the model only.
 *
 *  `fallbackTurnsDone` covers the attempt with no recorded depth: that does not
 *  happen for a `done` attempt, which always writes its own (see the migration
 *  that introduced the column), but its type stays nullable for the attempts
 *  never played. */
export function groupByModelAndDepth(
  cells: DeepenCell[],
  fallbackTurnsDone: number,
): DeepenGroup[] {
  const groups = new Map<string, DeepenGroup>();
  for (const cell of cells) {
    const turnsDone = cell.turns_done ?? fallbackTurnsDone;
    const key = `${cell.target_model}\0${turnsDone}`;
    const group = groups.get(key);
    if (group) {
      group.cells += 1;
    } else {
      groups.set(key, {
        target_model: cell.target_model,
        turns_done: turnsDone,
        cells: 1,
      });
    }
  }
  return [...groups.values()];
}

/** The quote for deepening these attempts up to `to` turns.
 *
 * One call to `estimateDeepening` per group — see `groupByModelAndDepth` —
 * summed with `addEstimates`: it returns a fair price only for one model and one
 * starting depth at a time. Grouping by model alone would underestimate the
 * group left behind by an earlier deepening, billing it from a depth it has not
 * reached.
 *
 * Shared between the panel, which calls it on the selection it already has in
 * memory (see `samplesForSelection`), and `extendRun`, which calls it on what it
 * has just read from the database for the same extension: neither must bill the
 * attempts already deepened at the tariff of the ones left behind. */
export function estimateDeepeningCost(
  config: EvalRunConfig,
  cells: DeepenCell[],
  to: number,
  fallbackTurnsDone: number,
    /** The assumed lengths, passed through as they stand to
     *  `estimateDeepening` — evaluated answers and adversary, each its own. */
  lengths?: LengthAssumption | number | null,
): CostEstimate | null {
  return groupByModelAndDepth(cells, fallbackTurnsDone).reduce<CostEstimate | null>(
    (total, group) =>
      addEstimates(
        total,
        estimateDeepening(
          { ...config, models: { ...config.models, targets: [group.target_model] } },
          group.turns_done,
          to,
          group.cells,
          lengths,
        ),
      ),
    null,
  );
}
