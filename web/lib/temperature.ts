// The temperature of each repetition in a batch of cells.
//
// This computation lives here rather than in the job, because it is the API
// route that decides which cells to create, and it alone knows a batch's
// boundary. A run being completed receives a spread for its *new* repetitions;
// the old ones keep the one they had, since each cell carries its own
// temperature in the database. Recomputing after the fact from the run's
// configuration would rewrite the history of cells already paid for.
//
// Ported from `temperatures_for` (backend/playground/eval_task.py), whose tests
// it takes over.
import type { TemperatureSpec } from "./types";

/** The temperature of each repetition.
 *
 * With no instruction, no temperature is sent and the provider applies its own
 * default. With an upper bound, the repetitions spread linearly between the two
 * bounds, inclusive. A single repetition takes the lower bound: there is no
 * interval to travel.
 *
 * The last repetition returns `spec.max` as it stands rather than computing it
 * by accumulation: `spec.min + step * index` can land a hair away from the upper
 * bound through floating-point rounding (`0.2 + 0.7 === 0.8999999999999999`),
 * which the bound the user asked for must not suffer. */
export function temperaturesFor(
  spec: TemperatureSpec | null | undefined,
  repetitions: number,
): (number | null)[] {
  const indices = Array.from({ length: repetitions }, (_, index) => index);
  if (!spec) return indices.map(() => null);
  const max = spec.max;
  if (max == null || repetitions === 1) return indices.map(() => spec.min);
  const step = (max - spec.min) / (repetitions - 1);
  return indices.map((index) =>
    // Rounded because these values are written to the database and read back in
    // the exports: `0.2 + 0.1` is 0.30000000000000004, and four decimals
    // already go far beyond what a provider tells apart.
    index === repetitions - 1
      ? max
      : Math.round((spec.min + step * index) * 1e4) / 1e4,
  );
}
