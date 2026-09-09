// What a finished run can say about the length of its own answers.
//
// A fresh run's quote rests on a declared number: nobody has data on a matrix
// that has never run. An extension, though, prolongs a run that has finished —
// its tokens are billed, counted, recorded. Asking someone for them again would
// be making them guess what we already know.
//
// Nothing here touches the database or the network: the module takes cells and
// returns numbers, so that it tests on its own.
import { SHARED_PRICING as S } from "./shared.ts";
import type { EvalModels, ModelUsage, SampleStatus } from "./types";

/** What a cell must carry to be measurable. Knowingly narrower than
 *  `EvalSample`: no transcript, no grade, no date — the query therefore has
 *  only five columns to bring back, where the transcripts weigh hundreds of
 *  kilobytes. */
export interface MeasurableCell {
  scenario_index: number;
  target_model: string;
  status: SampleStatus;
  /** The depth at which that particular cell played, and not the run's: a
   *  deepened run carries cells deeper than others, and `config.turns` names
   *  only the last depth asked for. `null` for the cells predating the column,
   *  which then fall back on the run's — same convention as
   *  `groupByModelAndDepth`. */
  turns_done: number | null;
  usage: Record<string, ModelUsage>;
}

export interface MeasuredLengths {
  /** Output tokens per turn, for each scenario that has cells of its own. An
   *  absent scenario has none. */
  byScenario: Map<number, number>;
  /** The same thing across the whole run, pooled. `null` if nothing is
   *  measurable. */
  run: number | null;
  /** Output tokens per adversary turn, or `null` — a single-turn run, an
   *  adversary holding several roles at once, or nothing measurable. */
  adversary: number | null;
  /** How many finished cells were set aside because their evaluated model was
   *  also playing another role. Used to say so on screen rather than hide it. */
  skipped: number;
  /** How many cells actually carried the measurement. A quote resting on two
   *  cells does not read like a quote resting on two hundred. */
  kept: number;
}

interface Pool {
  tokens: number;
  calls: number;
}

const addTo = (pool: Pool, tokens: number, calls: number): void => {
  pool.tokens += tokens;
  pool.calls += calls;
};

/** A pool's mean, or `null` when there is nothing to draw from it.
 *
 * A null total is not a measurement of zero: a run whose output was entirely
 * blocked by the provider has not learned that answers are free, it has learned
 * nothing at all. Letting it through was costing the extension at one token per
 * turn — `clamp` raising the zero to one — under a sentence announcing "0 output
 * tokens per turn". It is the same treatment as a cell with no counter: mute
 * rather than null.
 *
 * The guard bears on the rounded result, not on the raw total: a non-empty pool
 * can round to zero (a few tokens over dozens of calls) without the total being
 * null itself, and that mean is just as little a measurement — it would return
 * the same "0 output tokens per turn" by another route. */
const mean = (pool: Pool): number | null => {
  if (pool.calls === 0) return null;
  const value = Math.round(pool.tokens / pool.calls);
  return value > 0 ? value : null;
};

/** Measures the output lengths of a finished run.
 *
 * A cell's denominator is *its* depth — `turns_done` — not the one the run shows
 * today: an extension can raise `turns` without deepening a single cell, and the
 * deepening itself touches only the chosen cells. A run therefore commonly
 * carries cells at mixed depths, and dividing them all by the most recent
 * returns a length all the lower for how far the run was pushed. `turns` stays
 * the fallback for cells predating the column.
 *
 * The denominator is the depth, not the number of calls actually billed: the
 * estimator only adds the evaluated model's answer `turns` times per
 * conversation, having no model of tool calls. Dividing by the real calls would
 * make it return less than the observed total, all the more so as a scenario
 * uses tools. By dividing by the turns, the measurement absorbs that inflation
 * and the quote reproduces exactly what was paid.
 *
 * A cell whose evaluated model is also judge or adversary is set aside: `usage`
 * is indexed by model name and never by role, so that its answers and its
 * verdicts add up on the same line — and a re-judgement, which `add_usage`
 * accumulates, makes the mixture worse still. Setting them aside loses nothing:
 * the length being a property of the scenario and not of the model, measuring it
 * on the models that do not hold several roles is worth as much as measuring it
 * on all of them. */
export function measureRun(
  cells: MeasurableCell[],
  models: EvalModels,
  turns: number,
): MeasuredLengths {
  const otherRoles = new Set(
    [models.judge, models.adversary].filter((model): model is string =>
      Boolean(model),
    ),
  );
  const adversary = turns > 1 ? models.adversary : null;
  /** This cell's depth, or the run's for a row written before the column
   *  existed. */
  const depthOf = (cell: MeasurableCell): number => cell.turns_done ?? turns;
  // An adversary that is also evaluated or judge is unreadable for the same
  // reason as the targets that hold several roles.
  const adversaryReadable =
    adversary != null &&
    adversary !== models.judge &&
    !models.targets.includes(adversary);

  const perScenario = new Map<number, Pool>();
  const run: Pool = { tokens: 0, calls: 0 };
  const adversaryPool: Pool = { tokens: 0, calls: 0 };
  let skipped = 0;
  let kept = 0;

  for (const cell of cells) {
    if (cell.status !== "done") continue;

    if (adversaryReadable) {
      const tokens = cell.usage[adversary]?.output_tokens;
        // One push fewer than there are turns, and zero pushes for a cell that
        // settled at the first: counting it there would divide by zero.
      const pushes = depthOf(cell) - 1;
      if (tokens != null && pushes > 0) {
        addTo(adversaryPool, tokens, pushes);
      }
    }

    if (otherRoles.has(cell.target_model)) {
      skipped += 1;
      continue;
    }
    const tokens = cell.usage[cell.target_model]?.output_tokens;
      // A cell with no counter is not a cell at zero tokens: it is mute, and
      // counting it would drag the mean down without measuring anything.
    if (tokens == null) continue;

    const turns = depthOf(cell);
    if (turns <= 0) continue;
    const pool = perScenario.get(cell.scenario_index) ?? { tokens: 0, calls: 0 };
    addTo(pool, tokens, turns);
    perScenario.set(cell.scenario_index, pool);
    addTo(run, tokens, turns);
    kept += 1;
  }

  const byScenario = new Map<number, number>();
  for (const [index, pool] of perScenario) {
    const value = mean(pool);
    if (value != null) byScenario.set(index, value);
  }

  return {
    byScenario,
    run: mean(run),
    adversary: adversaryReadable ? mean(adversaryPool) : null,
    skipped,
    kept,
  };
}

/** The length to assume for each of these scenarios, in the order given.
 *
 * The cascade says what is known, from the most precise to the vaguest: this
 * scenario's measurement, failing that the run's — a scenario added will
 * resemble the ones before — failing that what the author had declared, failing
 * that the general average for runs predating the field. */
export function answerLengthsFor(
  scenarioIndices: number[],
  measured: MeasuredLengths,
  declared: number | undefined,
): number[] {
  const fallback = measured.run ?? declared ?? S.default_response_tokens;
  return scenarioIndices.map(
    (index) => measured.byScenario.get(index) ?? fallback,
  );
}
