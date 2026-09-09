// The old front door to the scenario advice, kept as it was.
//
// The advice has become four documents — see `advice.ts`, which holds them —
// and this file keeps only the first, under its old names. It is named in the
// MCP server's instructions, interpolated into `agent-prompt.ts`, and served by
// the `/scenario-advice` route: breaking it would break every agent already
// written, for nothing.
//
// One single definition of the text, in `advice/scenario.ts`. A copy here would
// have diverged — exactly the reason it left the profiles in the first place.
import { DEFAULT_ADVICE } from "./advice.ts";

/** The scenario-writing advice. An alias of the `scenario` topic — see
 *  `DEFAULT_ADVICE` in `advice.ts`. */
export const DEFAULT_SCENARIO_ADVICE = DEFAULT_ADVICE.scenario;

/** The advice to serve: the override if it carries text, the default
 *  otherwise.
 *
 * A blank override falls back to the default rather than returning an empty
 * string. Emptying the field on screen is the gesture for "put the default
 * back", not "send my agent nothing" — and an MCP tool returning emptiness
 * would leave the agent writing with no guard rail at all, without anyone
 * having wanted that. */
export function scenarioAdvice(override: string | null | undefined): string {
  return override && override.trim() !== "" ? override : DEFAULT_SCENARIO_ADVICE;
}
