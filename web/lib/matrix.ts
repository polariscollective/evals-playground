// A run's matrix, aggregated from its cells.
//
// A port of what `backend/playground/matrix.py` used to do: the computation now
// lives on the reading side, since it is the interface that shows it and the
// export that copies it.
//
// Since the multiple judges, a conversation's grade is no longer a column of
// `eval_samples` (`score`, `justification` — dropped by the migration
// `20260906093000_drop_eval_samples_score_columns.sql`, polaris-supabase
// repository): it is a row of `judge_scores`, one per (judge, conversation).
// **The matrix follows the principal judge** — see the design,
// docs/superpowers/specs/2026-09-06-juges-multiples.md, section « L'écran » —
// never another judge that has not been deleted: `cellsOf`/`overallMean`
// therefore look only at the principal's verdict on each conversation, which
// the caller brings them already joined from `EvalSample` and `judge_scores`.
import type { Cell, Progress, RubricLevel, SampleStatus } from "./types";
import { controlRows, deviation, targetOf } from "./targets.ts";
import type { JudgeTarget } from "./types";
import { PLAIN_VIEW, aggregate, mapScore, type MatrixView } from "./view.ts";
// The threshold and the predicate of the run's indicator: the count per cell
// must stop on exactly the same rule, without which adding up the cell markers
// would no longer land on the figure shown at the top of the screen.
import { isAwarenessFlagged, type JudgeVerdict } from "./awareness.ts";

/** Where a run stands, counted on its cells rather than on a separate counter.
 *
 * `total` comes from the number of rows, all created at launch: the progress is
 * therefore exact before the job even starts.
 *
 * Looks only at the conversation's execution status (`EvalSample.status`, a
 * column the multiple-judges migration did not touch) — never at a judge's
 * verdict, which lives elsewhere now. A `done` conversation counts as done here
 * even if no judge has yet been over it: `cellsOf`, further down, is the place
 * that distinguishes "played, not yet judged" from "judged". */
export function progressOf(samples: { status: SampleStatus }[]): Progress {
  const progress: Progress = {
    total: samples.length,
    done: 0,
    running: 0,
    pending: 0,
    errored: 0,
    cancelled: 0,
  };
  for (const sample of samples) {
    if (sample.status === "done") progress.done += 1;
    else if (sample.status === "running") progress.running += 1;
    else if (sample.status === "error") progress.errored += 1;
    else if (sample.status === "cancelled") progress.cancelled += 1;
    else progress.pending += 1;
  }
  return progress;
}

function emptyCell(): Cell {
  return {
    judged: 0,
    unjudged: 0,
    errored: 0,
    cancelled: 0,
    excluded: 0,
    pending: 0,
    mean: null,
    grades: {},
    cost_usd: 0,
    awareness_flagged: 0,
  };
}

/** A conversation as the matrix sees it: its coordinates, the status of its
 *  *execution* — independent of any judge, it is `EvalSample.status` — and the
 *  verdict of the PRINCIPAL judge, the only one the matrix shows.
 *
 * `awake` travels apart from `principal`: they are two different judges on the
 * same conversation. A cell's awareness badge depends in no way on what the
 * principal decided — a cell that broke down, or was never judged by the
 * principal, keeps its awareness signal if the awareness judge did answer.
 *
 * The caller builds this shape by joining `EvalSample` — for the first four
 * fields — and the rows of `judge_scores` of the principal and, if the run has
 * one, of the `awake` link (see `findAwakeJudge`, `awareness.ts`), filtered by
 * `sample_id`. This module reads neither `eval_samples` nor `judge_scores`
 * itself. */
export interface MatrixSample {
  scenario_index: number;
  target_model: string;
  status: SampleStatus;
  cost_usd: number | null;
  principal: JudgeVerdict;
  /** `undefined`: no link of type `awake` on this run — never asked for at
   *  launch, or unlinked since. Distinct from a `"pending"` verdict: "no
   *  awareness judge" and "awareness judge not been over it yet" must not be
   *  confused, the first never becoming the second. */
  awake?: JudgeVerdict;
}

/** The matrix, one entry per scenario.
 *
 * The list always keeps `scenarioCount` entries, even empty ones: it is aligned
 * on `config.scenarios`, and a missing row would shift the whole reading.
 *
 * A cell with no grade is counted apart rather than ignored — and a cell that
 * broke down apart again. The mean says nothing about what it could not
 * measure, and "the model scored zero" is not "we do not know".
 *
 * Two statuses now combine to place a conversation: that of its execution
 * (`sample.status`) first — a conversation that has not finished playing, or
 * never started, or fell over mid-play, does not even look at the judge. Only
 * then, for a `done` conversation, that of the principal's verdict
 * (`sample.principal.status`): `"pending"` (the job has not been over it yet)
 * counts as waiting on the same footing as a conversation still under way, and
 * `"error"` (the judge fell over on an otherwise valid conversation) counts as
 * broken down on the same footing as an execution that failed — they are two
 * different breakdowns, but the matrix distinguishes them no more than it did
 * before. */
export function cellsOf(
  samples: MatrixSample[],
  scenarioCount: number,
  rubric?: RubricLevel[],
  view: MatrixView = PLAIN_VIEW,
  targets?: JudgeTarget[] | null,
): Record<string, Cell>[] {
  const cells: Record<string, Cell>[] = Array.from(
    { length: scenarioCount },
    () => ({}),
  );
  // The grade as this reading counts it: the grade itself, or the distance
  // from what this judge expected of THIS row. `null` puts it outside the
  // computation, exactly as an excluded level does — and a row with no target,
  // under the deviation reading, has nothing to show, which is the case of an
  // extension whose targets did not follow.
  const valueOf = (score: number, scenarioIndex: number): number | null => {
    if (!view.relative) return mapScore(score, rubric, view);
    const target = targetOf(targets, scenarioIndex);
    if (target === undefined) return null;
    return deviation(score, target.expected, rubric);
  };
  // The grades are kept and not added up on the fly: a median or a minimum
  // require seeing them all, which a running sum forbids.
  const notes = new Map<string, number[]>();

  for (const sample of samples) {
    if (sample.scenario_index < 0 || sample.scenario_index >= scenarioCount) {
      continue;
    }
    const row = cells[sample.scenario_index];
    if (!row[sample.target_model]) row[sample.target_model] = emptyCell();
    const cell = row[sample.target_model];
    cell.cost_usd += sample.cost_usd ?? 0;
      // Independent of the execution status and of the principal's verdict: the
      // awareness judge grades a conversation whether or not the principal was
      // able to decide on it. Same predicate as `awarenessSummary` at run level
      // (`isAwarenessFlagged`) — not merely the same threshold — and that is
      // what holds the sum invariant.
    if (sample.awake && isAwarenessFlagged(sample.awake)) {
      cell.awareness_flagged += 1;
    }

    if (sample.status === "pending" || sample.status === "running") {
      cell.pending += 1;
    } else if (sample.status === "cancelled") {
        // Never started. Not a breakdown: it was decided not to do it.
      cell.cancelled += 1;
    } else if (sample.status === "error") {
        // The execution itself failed: there is nothing to judge.
      cell.errored += 1;
    } else if (sample.principal.status === "pending") {
        // Played, but the principal has not been over it yet.
      cell.pending += 1;
    } else if (sample.principal.status === "error") {
        // The principal fell over on an otherwise valid conversation.
      cell.errored += 1;
    } else if (sample.principal.score === null) {
      cell.unjudged += 1;
    } else {
      const value = valueOf(sample.principal.score, sample.scenario_index);
      if (value === null) {
        // Put outside, either by the scale — the judge decided "not
        // applicable" — or by the view. It is an answer, not an absence of
        // answer, but it does not enter the computation.
        cell.excluded += 1;
      } else {
        cell.judged += 1;
        const key = `${sample.scenario_index} ${sample.target_model}`;
        notes.set(key, [...(notes.get(key) ?? []), value]);
      }
    }
  }

  for (const [key, values] of notes) {
    const separator = key.indexOf(" ");
    const index = Number(key.slice(0, separator));
    const target = key.slice(separator + 1);
    const cell = cells[index][target];
    cell.mean = aggregate(values, view.aggregate);
    // The grades were already kept whole for the median; counting them here
    // costs nothing more and makes legible what a mean hides.
    for (const value of values) {
      cell.grades[value] = (cell.grades[value] ?? 0) + 1;
    }
  }

  return cells;
}

/** The figure of a whole run, or null if nothing could be graded.
 *
 * Computed on the grades and not on the cells' figures: aggregating aggregates
 * would give the same weight to a cell graded ten times and to a cell graded
 * once.
 *
 * Looks only at the PRINCIPAL judge's verdict, like `cellsOf`: it matters
 * little *why* it did not grade (pending, fell over, empty conversation, grade
 * off the scale) — a null score never enters the mean, exactly as before the
 * grade came to live in its own table. */
export function overallMean(
  samples: Pick<MatrixSample, "principal" | "scenario_index">[],
  rubric?: RubricLevel[],
  view: MatrixView = PLAIN_VIEW,
  targets?: JudgeTarget[] | null,
): number | null {
  // Control rows leave the overall figure. They are odd on purpose — a
  // feasibility row aims at the TOP of the scale, a cooperative model being
  // meant to go there — and mixing them in would make that number say something
  // nobody asked for.
  //
  // Follows the judge whose targets are displayed, like everything else in the
  // matrix: the same row can be a control for the principal and an ordinary row
  // for another judge.
  const controls = controlRows(targets);
  const notes = samples
    .filter((sample) => !controls.has(sample.scenario_index))
    .map((sample) => {
      if (sample.principal.score === null) return null;
      if (!view.relative) return mapScore(sample.principal.score, rubric, view);
      const target = targetOf(targets, sample.scenario_index);
      if (target === undefined) return null;
      return deviation(sample.principal.score, target.expected, rubric);
    })
    .filter((value): value is number => value !== null);
  return aggregate(notes, view.aggregate);
}
