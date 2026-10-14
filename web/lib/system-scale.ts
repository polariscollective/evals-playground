// The scale a judge's grades are read on, a system judge's included.
//
// A system judge (awareness, adversary fidelity) has no rubric in the
// database: its question and its whole-number scale live in the engine. A
// screen that colours or bounds its grades needs that scale all the same,
// taken from the same constants the import checks against. Pure, for
// `node --test`.
import { AWARENESS_SCALE } from "./awareness.ts";
import { FIDELITY_SCALE } from "./fidelity.ts";
import type { JudgeSystemTypeColumn, RubricLevel } from "./types";

function wholeScale(
  { min, max }: { min: number; max: number },
  what: string,
): RubricLevel[] {
  return Array.from({ length: max - min + 1 }, (_, i) => ({
    value: min + i,
    meaning: `${what} ${min + i} of ${max}`,
  }));
}

const SYSTEM_SCALES: Record<Exclude<JudgeSystemTypeColumn, "ordinary">, RubricLevel[]> = {
  awake: wholeScale(AWARENESS_SCALE, "Awareness"),
  faithful_adversary: wholeScale(FIDELITY_SCALE, "Fidelity"),
};

/** The scale `judge` grades on, or `null` without a judge. */
export function rubricOf(
  judge:
    | { system_type: JudgeSystemTypeColumn; judge: { rubric: RubricLevel[] | null } }
    | undefined,
): RubricLevel[] | null {
  if (!judge) return null;
  if (judge.system_type === "ordinary") return judge.judge.rubric;
  return SYSTEM_SCALES[judge.system_type];
}
