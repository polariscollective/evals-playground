// Which cells to write to the database, and at what temperature.
//
// Separated from `runs.ts` because it is the only part that deserves testing on
// its own: the rest is only writes. It is also the code that once carried the
// building of the matrix on the Python side — it moved here the day the job
// stopped rebuilding it from the configuration.
import { temperaturesFor } from "./temperature.ts";
import type { EvalRunConfig, EvalScenario, TemperatureSpec } from "./types";

/** An `eval_samples` row as it is born: pending, with no result. */
export interface NewCell {
  scenario_index: number;
  scenario_title: string;
  target_model: string;
  repetition: number;
  temperature: number | null;
}

/** The key of a scenario × model pair, a matrix cell's column. */
export function coupleKey(scenarioIndex: number, target: string): string {
  return `${scenarioIndex} ${target}`;
}

/** The full matrix of a fresh run: a scenario × model × repetition triple.
 *
 * The temperatures start over for each pair: without that, the following
 * scenarios would inherit shifted temperatures and the comparison would rest on
 * different settings from one row to the next. */
export function cellsForRun(config: EvalRunConfig): NewCell[] {
  const temperatures = temperaturesFor(config.temperature, config.repetitions);
  const cells: NewCell[] = [];
  for (const [index, scenario] of config.scenarios.entries()) {
    for (const target of config.models.targets) {
      for (let repetition = 0; repetition < config.repetitions; repetition += 1) {
        cells.push({
          scenario_index: index,
          scenario_title: scenario.title,
          target_model: target,
          repetition,
          temperature: temperatures[repetition],
        });
      }
    }
  }
  return cells;
}

/** The cells to add to an existing run.
 *
 * The repetitions continue their pair's numbering rather than starting over
 * from zero: that is what tells "add three attempts" from "redo the first
 * three", and what stops the uniqueness constraint refusing the insert. A pair
 * never covered yet — a new scenario, a new model — does start at zero.
 *
 * @param scenarios The complete list, old and new one after the other.
 * @param lastRepetition The last repetition of each pair already in the
 *   database. */
export function cellsForExtension(
  scenarios: EvalScenario[],
  indices: number[],
  targets: string[],
  repetitions: number,
  temperature: TemperatureSpec | null | undefined,
  lastRepetition: Map<string, number>,
): NewCell[] {
  // The spread applies to the *added* repetitions, not to the total: the old
  // ones keep the temperature they had, written on their own row.
  const temperatures = temperaturesFor(temperature, repetitions);
  const cells: NewCell[] = [];
  for (const index of indices) {
    const scenario = scenarios[index];
    if (!scenario) continue;
    for (const target of targets) {
      const start = (lastRepetition.get(coupleKey(index, target)) ?? -1) + 1;
      for (let offset = 0; offset < repetitions; offset += 1) {
        cells.push({
          scenario_index: index,
          scenario_title: scenario.title,
          target_model: target,
          repetition: start + offset,
          temperature: temperatures[offset],
        });
      }
    }
  }
  return cells;
}
