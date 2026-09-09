// Which tools a scenario really receives.
//
// Separated because three places need it — the quote, the validation and the
// screen — and because a three-state rule copied three times ends up no longer
// saying the same thing everywhere.
import type { EvalRunConfig, EvalScenario, ExtendRequest, ToolSpec } from "./types";

/** A string that carries something other than whitespace.
 *
 * Repeated in several files (`validate.ts`, `world-warnings.ts`) rather than
 * shared: this one cannot import from `validate.ts`, which already imports
 * `servesTools` from here — a cycle. */
function isFilled(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** The tools offered to a scenario.
 *
 * Three states, and they matter: the absent key offers the whole run's setting,
 * a list offers what it names, an empty list offers nothing. Without the third,
 * one could not compare a row with tools to the same row without them, which is
 * often the measurement one is after.
 *
 * A name that designates no tool is ignored: validation refuses it upstream,
 * and nothing here must trip over a configuration already accepted. */
export function toolsFor(
  config: Pick<EvalRunConfig, "tools">,
  scenario: Pick<EvalScenario, "tools">,
): ToolSpec[] {
  const tools = config.tools ?? [];
  if (scenario.tools == null) return tools;
  const wanted = new Set(scenario.tools);
  return tools.filter((tool) => wanted.has(tool.name));
}

/** Does this tool go through the environment model?
 *
 * Twin of `ToolSpec.served` on the Python side, and for the same reason: the
 * discriminant lives in one place, without which one forgets it at the third
 * call site. Trimmed because a half-erased field in a form must not tip a tool
 * into being served — and therefore billed. */
export function served(tool: Pick<ToolSpec, "retrieval_rules">): boolean {
  return isFilled(tool.retrieval_rules);
}

/** Does this tool return a fixed result, written in advance?
 *
 * The other half of the exclusion `served` already names (IMPORTANT 3): without
 * it, `!tool.result.trim()` elsewhere (`ToolsEditor.tsx`) was not null-safe
 * like its twin, and `toolsProblem` never demands `result` — a served tool that
 * a direct request (outside the composer) deprives of `result` would reach that
 * read and break the rendering instead of merely hiding the wrong field. The
 * two halves of an exclusion must read their field the same way, without which
 * there exists a state where neither shows — or, here, where one brings the
 * screen down. */
export function fixed(tool: Pick<ToolSpec, "result">): boolean {
  return isFilled(tool.result);
}

/** Does this tool change the world when it is called?
 *
 * Twin of `ToolSpec.writes` on the Python side, trimmed like it. A second axis,
 * entirely independent of `served`: the four combinations all exist, and
 * fixed-and-writing is the most common — `delete_records` returns a fixed
 * string and empties a table all the same.
 *
 * What the divergence would cost is not a refusal at startup, as for `served`,
 * but a silent lie: a quote that does not count a log the job will keep. */
export function writesWorld(tool: Pick<ToolSpec, "world_effect">): boolean {
  return isFilled(tool.world_effect);
}

/** Does this run write into its world?
 *
 * What decides that a log exists — hence that the cache key carries something
 * other than the empty log's fingerprint, and that the quote has one more block
 * to count. */
export function writesWorldTools(
  tools: readonly Pick<ToolSpec, "world_effect">[],
): boolean {
  return tools.some(writesWorld);
}

/** Does this run serve at least one tool?
 *
 * The question the two refusals of `models.world` ask: required as soon as a
 * tool serves, forbidden otherwise. */
export function servesTools(
  tools: readonly Pick<ToolSpec, "retrieval_rules">[],
): boolean {
  return tools.some(served);
}

/** The model that serves — or will serve — this run's tools, once this
 *  extension is taken into account.
 *
 * The run's own always wins: `extendProblem` refuses to let an extension change
 * one that already exists, so `config.models.world` takes precedence. Only when
 * the run has none yet — because it serves nothing, or because it predates this
 * field — does the one named by the request count, and it alone fills the gap.
 *
 * Three callers each laid down `config.models.world || request.world || null`
 * on their own side: `extendRun` when writing the configuration, an extension's
 * quote when costing it, the screen when showing it. One copy only, so as not
 * to let one of the three answer differently the day the rule changes.
 *
 * `isFilled`, not raw `||` (MINOR): a `models.world` of a single space is
 * storable on a run that serves nothing — nothing here prevents it, and
 * `configProblem` never applies to an extension — and `||` would return it all
 * the same, truthy as it is. The quote would then cost the served part on that
 * model, which no tariff knows: not free, but counted as zero without anything
 * saying so. */
export function resolvedWorld(
  config: Pick<EvalRunConfig, "models">,
  request: Pick<ExtendRequest, "world">,
): string | null {
  if (isFilled(config.models.world)) return config.models.world as string;
  if (isFilled(request.world)) return request.world as string;
  return null;
}
