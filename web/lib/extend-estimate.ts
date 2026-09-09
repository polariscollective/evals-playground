// An extension's quote: one computation, called from both sides.
//
// The panel announces a price before one confirms; `extendRun` records that of
// the same extension just afterwards. They were two distinct computations, and
// two computations of the same thing always end up saying different things: the
// panel passed no length and fell back on the declared number where the server
// weighed what the run had actually spent — up to a factor of three on a
// deepening, under a sentence that promised "priced on what this run actually
// spent" all the same.
//
// There is therefore only one function left, and both callers call it. It
// touches neither the database nor the network: each brings it what it already
// knows, the page its cells in memory and `extendRun` the ones it has just
// read.
import { addEstimates, estimateCost } from "./pricing.ts";
import { estimateDeepeningCost } from "./deepen-counts.ts";
import { answerLengthsFor } from "./measured-length.ts";
import type { DeepenCell } from "./deepen-counts";
import type { MeasuredLengths } from "./measured-length";
import type {
  CostEstimate,
  EvalRunConfig,
  EvalScenario,
  ToolSpec,
} from "./types";

/** A scenario the extension will have played, and the index it carries — or
 *  will carry — in the run.
 *
 * The index is not decorative: it is what says what the run has already measured
 * of that scenario. A new scenario has no already-played index and therefore
 * inherits the run's average, which is exactly `answerLengthsFor`'s cascade.
 * Carrying them in pairs forbids the shift that would give one scenario
 * another's length. */
export interface AddedScenario {
  index: number;
  scenario: EvalScenario;
}

/** What an extension adds, reduced to what sets its price. */
export interface Extension {
  /** The scenarios to play, existing and new alike, in order. */
  scenarios: AddedScenario[];
  /** The target models of the new cells. */
  targets: string[];
  /** How many attempts per fresh cell. */
  repetitions: number;
  /** The depth asked for: that of the new cells, and the depth to which the
   *  attempts being continued are pushed. */
  turns: number;
  /** The run's tools **after** the extension. */
  tools: ToolSpec[];
  /** The attempts to continue, reduced to the model that plays them and the
   *  depth they set off from. */
  deepen: DeepenCell[];
}

/** What this extension will cost, measurement included.
 *
 * `null` when it adds nothing and deepens nothing — there is then no price to
 * show, and nothing to add to the run's recorded quote.
 *
 * The lengths come from `measured`, never from the general constant: a scenario
 * replayed takes its own measurement, a new scenario the run's, and the
 * adversary its own. The config's declaration serves only as a last resort,
 * through `answerLengthsFor` and `resolve`. */
export function estimateExtension(
  config: EvalRunConfig,
  extension: Extension,
  measured: MeasuredLengths,
): CostEstimate | null {
  const { scenarios, targets, repetitions, turns, tools, deepen } = extension;

  // The new cells, at the depth asked for: that is the depth they will run at,
  // the configuration having received it before they are born.
  const added =
    scenarios.length > 0 && targets.length > 0
      ? estimateCost(
          {
            ...config,
            tools,
            turns,
            scenarios: scenarios.map((entry) => entry.scenario),
            models: { ...config.models, targets },
            repetitions,
          },
          {
            answer: answerLengthsFor(
              scenarios.map((entry) => entry.index),
              measured,
              config.average_output_tokens,
            ),
            adversary: measured.adversary,
          },
        )
      : null;

  // The deepening, grouped by (target model, starting depth) pair — see
  // `estimateDeepeningCost`. One single length for the answers and not one per
  // scenario: the groups are not scenarios, and one group covers several at
  // once. The adversary keeps its own, as for the fresh cells; both fall back on
  // the run's declaration when nothing could be measured. Nothing as long as the
  // depth asked for does not exceed the run's: `extendProblem` refuses to deepen
  // without that anyway.
  const deepened =
    deepen.length > 0 && turns > config.turns
      ? estimateDeepeningCost(config, deepen, turns, config.turns, {
          answer: measured.run,
          adversary: measured.adversary,
        })
      : null;

  if (!added) return deepened;
  return deepened ? addEstimates(added, deepened) : added;
}
