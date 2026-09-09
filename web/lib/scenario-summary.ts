// What a scenario carries beyond the three required fields.
//
// Separated from the rendering because it is the only part holding a rule, and
// the only part the repository knows how to test — `node --test` looks only at
// `lib/`.
import type { EvalScenario } from "./types";

/** A scenario's labels, in the order they are read.
 *
 * A scenario with nothing produces none, and that is the common case: a pill on
 * every row of a batch would teach nothing. What deserves to be seen is the
 * departure from the default.
 *
 * Hence the silence on an absent `tools`, which means "all the run's tools".
 * `tools: none` produces one, because it is a choice — and because confusing the
 * two would remove from the screen the comparison "the same row, with and
 * without tools", which is often the measurement one is after. */
export function scenarioBadges(scenario: EvalScenario): string[] {
  const badges: string[] = [];

  if (scenario.note?.trim()) badges.push("note");

  const turns = scenario.history?.length ?? 0;
  if (turns > 0) badges.push(`${turns} seeded turn${turns > 1 ? "s" : ""}`);

  // `!= null` and not the truthiness of the value: an empty list is falsy for
  // nobody in JavaScript, but it is precisely the state we want to name.
  if (scenario.tools != null) {
    badges.push(
      scenario.tools.length === 0
        ? "no tools"
        : `${scenario.tools.length} tool${scenario.tools.length > 1 ? "s" : ""}`,
    );
  }

  return badges;
}
