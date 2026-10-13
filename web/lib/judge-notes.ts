// Named judge notes on scenarios, and the one note a linked judge may choose.
//
// A note is added to a scenario under a name and never changed or removed
// (the database refuses both: migration
// 20261013160000_eval_runs_copies_and_judge_notes.sql, polaris-supabase). A
// judge linked with `judge_note: <name>` reads, after its criterion, the text
// of that name on each scenario that has one (`criterionWithNote`,
// judge-prompt.ts). Pure, for `node --test`.
import type { EvalScenario } from "./types";

/** The shape of a note name, the same as the database's check. */
export const JUDGE_NOTE_NAME = /^[a-z0-9-]+$/;

function nameProblem(name: string, where: string): string | null {
  return JUDGE_NOTE_NAME.test(name)
    ? null
    : `${where}: "${name}" is not a judge note name. Use lowercase letters, digits and hyphens, like persona-v2.`;
}

/** What is wrong with a scenario's `judge_notes`, or `null`. */
export function judgeNotesProblem(
  notes: Record<string, unknown> | null | undefined,
  where: string,
): string | null {
  if (notes == null) return null;
  if (typeof notes !== "object" || Array.isArray(notes)) {
    return `${where}: judge_notes must map note names to their texts.`;
  }
  for (const [name, text] of Object.entries(notes)) {
    const malformed = nameProblem(name, where);
    if (malformed) return malformed;
    if (typeof text !== "string" || text.trim() === "") {
      return `${where}: the judge note "${name}" is empty.`;
    }
  }
  return null;
}

/** Every note name the scenarios carry, each once, in order of appearance. */
export function noteNamesOf(
  scenarios: readonly Pick<EvalScenario, "judge_notes">[],
): string[] {
  const names: string[] = [];
  for (const scenario of scenarios) {
    for (const name of Object.keys(scenario.judge_notes ?? {})) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** What is wrong with a judge's choice of note on a run with these
 *  scenarios, or `null`. A name no scenario carries is refused: the judge
 *  would grade exactly as if it had none, and a typo would pass unseen. */
export function judgeNoteChoiceProblem(
  name: string | null | undefined,
  scenarios: readonly Pick<EvalScenario, "judge_notes">[],
  where: string,
): string | null {
  if (name == null || name === "") return null;
  const malformed = nameProblem(name, where);
  if (malformed) return malformed;
  const carried = noteNamesOf(scenarios);
  if (carried.includes(name)) return null;
  return carried.length === 0
    ? `${where}: judge_note "${name}" names a note no scenario of this run carries; none carries any yet.`
    : `${where}: judge_note "${name}" names a note no scenario of this run carries. Those it carries: ${carried.join(", ")}.`;
}
