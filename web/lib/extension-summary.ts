// What an extension did, in plain words.
//
// `eval_runs.extensions` carries each extension's complete request and had
// never shown it: the history said when, who, through which door and how many,
// never what.
//
// Separated from the rendering for the reason that separates
// `scenario-summary.ts`: it is the only part that holds a rule, and the only
// part `node --test` knows how to look at — it sees only `lib/`.
//
// The rule: assert nothing the record does not carry. The counts come from the
// request and the quote; when the quote is missing, the sentence says the shape
// and keeps quiet about the number, as `actual_cost_usd` is `null` rather than
// 0. And two things are not in it at all — which attempts were deepened, and
// from what depth — so the sentence says "pushed to 4 turns", never "from 3 to
// 4".
import type { EvalScenario, ExtendRequest, RunExtensionLogEntry } from "./types";

/** A label and what it lists. Never produced empty: a line with no value would
 *  teach nothing, and the departure from the default is what one comes to
 *  read. */
export interface SummaryLine {
  label: string;
  values: string[];
}

export interface ExtensionSummary {
  /** What the extension did, one sentence per gesture. Two at most: one can add
   *  cells AND deepen, never lay down a judge as well — `extendProblem` refuses
   *  to mix the two, the engine having only one pass per launch. */
  headlines: string[];
  /** What the sentences name without detailing. */
  lines: SummaryLine[];
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  n > 1 ? many : one;

/** How many cells this request brought into being.
 *
 * `cellsForExtension`'s formula, to the letter: the deduplicated indices plus
 * the new scenarios — which take positions at the tail and can therefore never
 * collide with the existing indices. */
function scenariosCovered(request: ExtendRequest): number {
  return new Set(request.scenario_indices).size + (request.new_scenarios ?? []).length;
}

export function summariseExtension(
  entry: RunExtensionLogEntry,
  scenarios: EvalScenario[],
): ExtensionSummary {
  const request = entry.request;
  const headlines: string[] = [];
  const lines: SummaryLine[] = [];

  // Laying down a judge mixes with nothing else. The branch therefore leaves
  // straight away, rather than composing with sentences that cannot coexist
  // with its own.
  const judges = request.new_judges ?? [];
  if (judges.length > 0) {
    const howMany = `${judges.length} ${plural(judges.length, "judge")} added`;
    const rereads = entry.estimate?.conversations ?? null;
    if (rereads === null) {
      headlines.push(`${howMany}.`);
    } else if (judges.length === 1) {
      headlines.push(
        `${howMany} — reread over ${rereads} ${plural(rereads, "conversation")} ` +
          `already played.`,
      );
    } else {
      // Every judge rereads all the finished conversations and `addEstimates`
      // sums the quotes: the total is "conversations × judges". Calling those
      // conversations would lie; they are rereads.
      headlines.push(
        `${howMany} — ${rereads} rereads over the conversations already played.`,
      );
    }
    lines.push({
      label: "Judges",
      // A judge named rather than described shows its handle: it is the only
      // thing the request carries about it, and the question lives on the judge.
      values: judges.map((judge) => {
        const asked = judge.criterion ?? `the judge "${judge.judge}"`;
        return judge.model ? `${asked} (${judge.model})` : asked;
      }),
    });
    return { headlines, lines };
  }

  // `targets` is required by `extendProblem` only if the request adds a cell;
  // an extension that merely deepens can therefore be recorded without one.
  const targets = request.targets ?? [];

  // The product below is exact only because `extendProblem`
  // (`web/lib/validate.ts`) refuses a `scenario_indices` out of bounds and
  // refuses duplicated `targets` before a request reaches the record — that is
  // what makes this count equal to `retenus.length` in `planExtension`
  // (`runs.ts:1206`, which warns against recomputing it beside
  // `cellsForExtension` rather than calling it). This module cannot call
  // `cellsForExtension`, which needs the live state of the run's cells — hence
  // this product held separately, to the same formula. And it matters: `cells`
  // is subtracted from `estimate.conversations` below to obtain the deepening's
  // count, so a drift would not merely miscount the cells — it would silently
  // mix the conversations between the two sentences, and could even make this
  // count negative.
  const covered = scenariosCovered(request);
  const cells = covered * targets.length * request.repetitions;
  if (cells > 0) {
    headlines.push(
      `${request.repetitions} ${plural(request.repetitions, "attempt")} ` +
        `added across ${covered} ` +
        `${plural(covered, "scenario")} × ${targets.length} ` +
        `${plural(targets.length, "model")} — ${cells} ` +
        `${plural(cells, "conversation")}.`,
    );
  }

  if (request.deepen !== undefined && request.turns != null) {
    // The count of pushed attempts is what remains of the quote once the new
    // cells are taken out: `estimateExtension` adds exactly those two parts,
    // and nothing else enters the total.
    const rereads = entry.estimate?.conversations;
    const pushed = rereads == null ? null : rereads - cells;
    const levels =
      request.deepen === "all" ? null : request.deepen.join(" or ");
    const depth = `to ${request.turns} ${plural(request.turns, "turn")}`;

    if (pushed === null) {
      headlines.push(
        levels === null
          ? `All graded attempts pushed ${depth}.`
          : `Attempts graded ${levels} pushed ${depth}.`,
      );
    } else {
      const attempts = `${pushed} ${plural(pushed, "attempt")}`;
      headlines.push(
        levels === null
          ? `${attempts} pushed ${depth} — all those that were graded.`
          : `${attempts} graded ${levels} pushed ${depth}.`,
      );
    }
  }

  if (request.scenario_indices.length > 0) {
    lines.push({
      label: "Scenarios",
      values: [...new Set(request.scenario_indices)].map(
        // An index that points at nothing is named by its number rather than
        // disappearing: it is a fact of the record, not a cell to hide.
        (index) => scenarios[index]?.title ?? `scenario ${index}`,
      ),
    });
  }
  const newScenarios = request.new_scenarios ?? [];
  if (newScenarios.length > 0) {
    lines.push({
      label: "New scenarios",
      values: newScenarios.map((scenario) => scenario.title),
    });
  }
  if (targets.length > 0) {
    lines.push({ label: "Models", values: [...targets] });
  }
  const tools = request.new_tools ?? [];
  if (tools.length > 0) {
    lines.push({ label: "Tools", values: tools.map((tool) => tool.name) });
  }
  if (request.temperature) {
    const { min, max } = request.temperature;
    lines.push({
      label: "Temperature",
      values: [max == null || max === min ? `${min}` : `${min} – ${max}`],
    });
  }
  // The depth only when no sentence has already said it: an extension may raise
  // the turns for its new cells without deepening anything existing.
  if (request.turns != null && request.deepen === undefined) {
    lines.push({
      label: "Depth",
      values: [`${request.turns} ${plural(request.turns, "turn")}`],
    });
  }

  return { headlines, lines };
}
