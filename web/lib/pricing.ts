// A run's quote, before launching it.
//
// **The one and only implementation of the estimate.** It was written in Python
// first (`88f90ef`), then ported here when the application moved to Next.js
// (`ef60372`); the Python copy stayed where it was without ever being called by
// the engine, and every change to the quote raised again the question of porting
// it. It was deleted rather than answering that once more — see
// docs/superpowers/specs/2026-09-08-devis-par-role-design.md. Do not recreate
// it: this file no longer has a twin to hold in agreement.
//
// What stays shared with Python is the data, not the computation:
// `shared/pricing.json` carries the tariffs, which `backend/playground/pricing.py`
// still reads for `actual_cost` — the *real* cost, counted afterwards on the
// tokens the providers report. The assumed lengths, for their part, serve only
// here.
import {
  SHARED_ADVERSARY_PROMPT as A,
  SHARED_AWARENESS_PROMPT as W,
  SHARED_FIDELITY_PROMPT as F,
  SHARED_JUDGE_PROMPT as J,
  SHARED_PRICING as S,
  SHARED_WORLD_PROMPT as M,
} from "./shared.ts";
// `served` and `servesTools` rather than an inline test: the quote used to
// decide on its own side what "being served" means, without trimming, where
// `configProblem` and the engine trim. A tool with blank `retrieval_rules` —
// lawful, see `toolsProblem` — was then costed as served while being served by
// nobody, and the quote announced an empty model. The discriminant lives in one
// place; three copies always end up diverging.
import { served, servesTools, toolsFor, writesWorld } from "./tools.ts";
import type {
  CostEstimate,
  EvalRunConfig,
  WrittenJudgeSpec,
  WrittenRunConfig,
  LengthAssumption,
  ModelCost,
  ModelRole,
  RubricLevel,
} from "./types";

// One tariff per model, with no tier — and that is only roughly true.
//
// Grok doubles its own beyond 200,000 input tokens. As long as the runs fitted
// in ten turns, the gap did not exist, and the multi-model catalogue's plan
// waves it away in one sentence: "a run of this product does not come near it —
// ten turns of a conversation make a few thousand tokens". The cap moved to a
// hundred, and the argument fell with it: every turn sends the whole history
// back, so with the longest answers the quote knows how to assume
// (`long_response_tokens`) a request in the last turns crosses the threshold.
//
// What is then underestimated is a very long Grok run, and silently. The Python
// twin makes the same flat computation on the tokens really consumed
// (`backend/playground/pricing.py`): the *observed* cost therefore drifts the
// same way, not only the quote.
//
// Nothing is done about it, and that is deliberate: nobody runs such a run
// today. The day somebody does, there are two ways of handling it — model the
// tier on both sides, or warn in the panel when a Grok run crosses it. Until
// then, this note is here so that the hole is not rediscovered through an
// invoice.
const PRICES = S.prices as Record<
  string,
  { input_per_mtok: number; output_per_mtok: number }
>;

const clamp = (tokens: number): number =>
  Math.max(1, Math.min(Math.round(tokens), 100_000));

const declared = (config: WrittenRunConfig): number =>
  clamp(config.average_output_tokens || S.default_response_tokens);

/** The lengths of each scenario, and that of the adversary.
 *
 * A bare number means "the same for everyone": it is the shape the short/long
 * bounds use, which frame the quote knowing nothing about the scenarios. */
function resolve(
  config: WrittenRunConfig,
  lengths: LengthAssumption | number | null | undefined,
): { perScenario: number[]; adversary: number } {
  const spec: LengthAssumption =
    lengths == null
      ? {}
      : typeof lengths === "number"
        ? { answer: lengths, adversary: lengths }
        : lengths;

  const fallback = declared(config);
  const answer = spec.answer;
  const perScenario = config.scenarios.map((_, index) => {
    if (Array.isArray(answer)) {
        // A list shorter than the scenarios is not an error: an extension may
        // have measured only some of them.
      const value = answer[index];
      return value == null ? fallback : clamp(value);
    }
    return answer == null ? fallback : clamp(answer);
  });

  return {
    perScenario,
    adversary: spec.adversary == null ? fallback : clamp(spec.adversary),
  };
}

function tokens(text: string): number {
  return Math.max(1, Math.floor(text.length / S.chars_per_token));
}

function rubricTokens(rubric: RubricLevel[] | undefined): number {
  return (rubric ?? []).reduce((sum, level) => sum + tokens(level.meaning) + 4, 0);
}

/** A template's tokens, once its placeholders are removed: the part the model
 * receives on every call whatever it is asked. */
function fixedTokens(text: string, ...placeholders: string[]): number {
  for (const placeholder of placeholders) text = text.replaceAll(placeholder, "");
  return tokens(text);
}

/** What each ordinary judge receives on every call on top of the run: its
 * system message and the skeleton of its user message — the principal as much as
 * each entry of `config.judges`, which share the same template and differ only
 * in their question, their scale and their model. Ignoring them underestimated
 * every call, all the more so as the matrix is large.
 *
 * Measured on the templates rather than written in: a rewording of the prompt
 * then carries through to the quote on its own. */
const JUDGE_OVERHEAD_TOKENS =
  // The head varies by whose turns the judge grades, and the three are within a
  // few tokens of one another; the assistant one is what nearly every judge
  // uses. Quoting the longest instead would over-bill every ordinary run to
  // avoid under-billing a rare one by a rounding error.
  fixedTokens(J.system_head_by_grades.assistant) +
  fixedTokens(J.system_tail) +
  fixedTokens(
    J.user_template,
    "{criterion}",
    "{transcript}",
    "{rubric}",
    "{values}",
  );

/** What the environment receives on top of the world, on every served call.
 *
 * Measured on the templates, as for the judge and the adversary: a rewording of
 * the prompt carries through to the quote on its own. */
const WORLD_OVERHEAD_TOKENS = fixedTokens(
  M.system +
    M.world_block +
    M.scenario_block +
    M.journal_block +
    M.call_block +
    M.rules_block +
    M.effect_block,
  "{world}",
  "{scenario_world}",
  "{journal}",
  "{tool}",
  "{arguments}",
  "{rules}",
  "{effect}",
);

/** How many served tool calls a conversation makes, roughly.
 *
 * **The middle of zero and the cap**, and it is the only defensible assumption:
 * no configuration declares how many times a model will call its tools, and the
 * only two known bounds are "never" and `max_tool_calls_per_turn` on every turn.
 * A choice taken on, which the quote's sentence names rather than hides. */
export function servedCallsPerConversation(config: WrittenRunConfig): number {
  return Math.floor((config.turns * (config.max_tool_calls_per_turn ?? 5)) / 2);
}

/** What the adversary receives on top of its objective. The confidentiality
 * notice appears there **twice**, before and after the objective — hence the
 * factor of two, which is not a typo. */
const ADVERSARY_OVERHEAD_TOKENS =
  fixedTokens(
    A.system_template,
    "{notice}",
    "{adversary_prompt}",
    "{opening_message}",
  ) +
  2 * tokens(A.confidentiality_notice);

/** What the awareness judge receives on top of the transcript: its system
 *  message and its template, scale included. Derived from the shared file like
 *  the principal judge's — a value written in here would stop describing what
 *  leaves at the first word changed in the prompt. */
const AWARENESS_OVERHEAD_TOKENS =
  fixedTokens(W.system) + fixedTokens(W.user_template, "{transcript}");

/** What the adversary-fidelity judge receives on top of the transcript: its
 *  system message, its template and its scale. The adversary's objective is
 *  counted at the call site, being the one part of this prompt that the run
 *  writes rather than the tool. */
const FIDELITY_OVERHEAD_TOKENS =
  fixedTokens(F.system) +
  fixedTokens(F.user_template, "{transcript}", "{adversary_prompt}");

/** What the checker receives on top of the world and the checked result.
 *
 * Derived from the shared file like the three above. It does **not** see the
 * `retrieval_rules`: `check_prompt` (`backend/playground/world.py`) refuses them
 * to it on purpose, so that it grades a coherence and not a compliance with the
 * line cap. The quote must refuse what the engine refuses, without which it
 * costs a different prompt from the one that leaves. */
const CHECK_OVERHEAD_TOKENS =
  fixedTokens(M.check_system) +
  fixedTokens(
    M.check_world_block +
      M.check_journal_block +
      M.check_call_block +
      M.check_answer_block +
      M.check_effect_block,
    "{world}",
    "{journal}",
    "{tool}",
    "{arguments}",
    "{result}",
    "{effect}",
  );

/** The checker of a run served by `worldModel`: the first candidate of
 *  `check_models` whose provider differs from its own.
 *
 * Twin of `check_model_for` (`backend/playground/world.py`), the one that
 * really calls. Two families, hence two ways of being wrong that do not
 * coincide — a checker sharing the server's bias would validate exactly the
 * errors one is looking for.
 *
 * This twin existed, then was deleted as dead code (`14dd817`) for want of a
 * caller. It has one now: without it, the quote passed over one model call per
 * served result in silence. */
export function checkModelFor(worldModel: string): string {
  const candidates: string[] = M.check_models;
  const provider = worldModel.split("/")[0];
  return (
    candidates.find((candidate) => candidate.split("/")[0] !== provider) ?? candidates[0]
  );
}

interface ModelTokens {
  role: ModelRole;
  model: string;
  input: number;
  output: number;
  responseTokens: number;
  /** The calls this row counts. Accumulated here, in the same place as the
   *  tokens, and not recomputed apart: two ways of counting the same calls would
   *  end up no longer saying the same thing, and `model_calls` is precisely the
   *  sum of these numbers. */
  calls: number;
}

/** The key of a quote row: a model, **in a given capacity**.
 *
 * `\0` because no model identifier and no role holds one — a separator one
 * cannot write is a separator that never gets confused with the data. */
export function roleKey(role: ModelRole, model: string): string {
  return `${role}\0${model}`;
}

/** A run's total volume, split by model.
 *
 * Each scenario is played out with its own answer length: since the whole
 * history is sent back on every turn, a scenario that calls for long answers
 * also swells the adversary's input and the judge's. */
export function estimateTokens(
  config: WrittenRunConfig,
  lengths?: LengthAssumption | number | null,
  billFrom = 0,
): { conversations: number; modelCalls: number; perModel: Map<string, ModelTokens> } {
  const { perScenario, adversary: adversaryLength } = resolve(config, lengths);
  const perModel = new Map<string, ModelTokens>();

  /** `responseTokens` is kept only at the first attribution.
   *
   * It is no longer an arbitration between roles — each has its row, and hence
   * its own assumption: a model's judge row now carries
   * `judge_response_tokens`, where the merge made it carry the length of its
   * answers as an evaluated model. It is an arbitration between **scenarios**,
   * which may declare different lengths and accumulate on the same evaluated
   * row: the first wins, for want of a single value that honestly describes
   * both. */
  const add = (
    role: ModelRole,
    model: string,
    input: number,
    output: number,
    answer: number,
    calls: number,
  ) => {
    const key = roleKey(role, model);
    const entry = perModel.get(key) ?? {
      role,
      model,
      input: 0,
      output: 0,
      responseTokens: 0,
      calls: 0,
    };
    if (entry.responseTokens === 0) entry.responseTokens = answer;
    entry.input += input;
    entry.output += output;
    entry.calls += calls;
    perModel.set(key, entry);
  };

  const adversary = config.turns > 1 ? config.models.adversary : null;
  const adversaryResponse = adversary ? adversaryLength : 0;
  const adversaryPrompt = tokens(config.adversary_prompt);

  /** The ordinary judges to bill: the principal, described by the run's
   * historical fields (`config.criterion`, `config.rubric`,
   * `config.models.judge`), then one per entry of `config.judges` — see the
   * docstring of `JudgeSpec`. Each carries its own question and its own scale,
   * hence its own token volume; an absent `model` takes the run's, exactly as at
   * launch (`judgesForLaunch`) — never all billed at the principal's tariff.
   * Computed once, outside the loop over the scenarios: neither a judge's
   * question nor its scale varies from one scenario to another.
   * A judge NAMED rather than described (`judge: <handle>`, see
   * `WrittenRunConfig`) carries neither here: its question lives on the judge,
   * which this function does not read — it takes no database. The quote is then
   * short by that judge's question and scale, a few hundred tokens against a
   * transcript of thousands, and only until the launch settles the handle: what
   * a run records is computed on the complete configuration. The form, which
   * has fetched the judge to show it, quotes on the complete text too. */
  const ordinaryJudges: { model: string; question: number }[] = [
    {
      model: config.models.judge,
      question: tokens(config.criterion ?? "") + rubricTokens(config.rubric),
    },
    ...(config.judges ?? []).map((spec) => ({
      model: spec.model ?? config.models.judge,
      question: tokens(spec.criterion ?? "") + rubricTokens(spec.rubric),
    })),
  ];

  // The world goes out whole on every environment call. It is not counted at
  // the cache tariff, even though the provider will most likely cache it: the
  // discount is guaranteed by nobody — it depends on the provider, on the
  // prefix's length and on the gap between two calls — and a quote that assumes
  // it underestimates every time it does not apply. And it is on that figure
  // that the decision to launch is taken.
  const worldTokens = tokens(config.world ?? "");
  const servedCalls = servedCallsPerConversation(config);

  // Lifted out before the loop: they depend only on `config` and on `billFrom`,
  // and each `add` now needs its number of calls at the moment it lays down its
  // tokens.
  //
  // The turns before `billFrom` are played out for the history but not billed:
  // only the billed turns count in the calls of the evaluated model and of the
  // adversary. Each judge, for its part, stays a single call as soon as there is
  // at least one billed turn — it rereads the whole conversation, never a
  // fragment.
  const billed = Math.max(config.turns - billFrom, 0);
  // A continuation (`billFrom > 0`) makes the adversary speak as many times as
  // the target: the opening push adds itself to the ordinary pushes. A fresh run
  // (`billFrom === 0`) keeps its usual count — its last push still does not
  // happen.
  const adversaryPushes =
    billed === 0 ? 0 : billFrom > 0 ? billed : billed - 1;

  config.scenarios.forEach((scenario, index) => {
    const system = tokens(scenario.system_prompt);
    const opening = tokens(scenario.opening_message);
      // A seeded history is sent back on every call, like the rest of the
      // conversation: forgetting it would underestimate the whole run, and all
      // the more so the more turns there are.
    const seeded = (scenario.history ?? []).reduce(
      (total, turn) => total + tokens(turn.content),
      0,
    );
      // The tool definitions go out again on every call of the evaluated model,
      // like the rest of the context.
    const toolTokens = toolsFor(config, scenario).reduce(
      (total, tool) =>
        total +
        tokens(tool.name) +
        tokens(tool.description) +
        tool.parameters.reduce(
          (sum, param) =>
            sum + tokens(param.name) + tokens(param.description) + tokens(param.type),
          0,
        ),
      0,
    );

    for (const target of config.models.targets) {
      const targetResponse = perScenario[index];
      let targetInput = 0;
      let targetOutput = 0;
      let adversaryInput = 0;
      let adversaryOutput = 0;
      let history = seeded + opening;

      for (let turn = 0; turn < config.turns; turn += 1) {
        const isBilled = turn >= billFrom;
        if (isBilled) {
          targetInput += system + toolTokens + history;
          targetOutput += targetResponse;
        }
        history += targetResponse;

        if (turn < config.turns - 1) {
            // The turn just before the resumption (`turn === billFrom - 1`)
            // carries the continuation's opening push: on the engine side, it is
            // the call the adversary makes before the target takes over again,
            // with the whole resumed conversation in front of it — and it is
            // billed like the others. A fresh run has no negative `billFrom - 1`
            // turn: the condition never fires there.
          const openingPush = turn === billFrom - 1;
            // The history already holds the opening message: count only the
            // adversary's prompt on top.
          if (isBilled || openingPush) {
            adversaryInput += adversaryPrompt + history + ADVERSARY_OVERHEAD_TOKENS;
            adversaryOutput += adversaryResponse;
          }
          history += adversaryResponse;
        }
      }

      const weight = config.repetitions;

      add(
        "evaluated",
        target,
        targetInput * weight,
        targetOutput * weight,
        targetResponse,
        billed * weight,
      );
      if (adversary && adversaryInput) {
        add(
          "adversary",
          adversary,
          adversaryInput * weight,
          adversaryOutput * weight,
          adversaryResponse,
          adversaryPushes * weight,
        );
      }
        // One model call per ordinary judge not deleted: each rereads the same
        // conversation, with its own question, its own scale and its own model —
        // three judges, three times the judging spend, never a single call billed
        // at the principal's tariff for the three.
        //
        // They share one row per model, not one row each: their number is
        // already said above the table, and four rows at the same tariff would
        // explain less than one row carrying "4 judges". The sum, for its part,
        // stays exact — each is costed on its own question.
        //
        // `billed > 0` keeps the tokens and the calls in agreement. Without that
        // guard, a continuation adding no turn would bill judge tokens while
        // announcing zero judge calls.
      if (billed > 0) {
        for (const { model, question } of ordinaryJudges) {
          const judgeInput = question + system + history + JUDGE_OVERHEAD_TOKENS;
          add(
            "judge",
            model,
            judgeInput * weight,
            S.judge_response_tokens * weight,
            S.judge_response_tokens,
            weight,
          );
        }
      }
        // A scenario that offers no served tool does not pay for the
        // environment. `tools: none` on a row is often the whole comparison one
        // is after: it must not carry the cost of a world it never questions.
      const offered = toolsFor(config, scenario);
      const servedTools = offered.filter(served);
        // The log, and what it weighs in the two prompts that receive it.
        //
        // The **fixed** tools that write are part of it: they cost no call, but
        // their entry swells the prompt of every read that follows. Counting
        // only `servedTools` would have missed them, and they are the common
        // form of writing tools.
        //
        // The middle of zero and the cap, like `servedCallsPerConversation`:
        // nothing declares how many writes a model will make. An entry weighs
        // the served result plus the effect sentence — never the `reasoning`,
        // which does not leave the database.
      const writers = offered.filter(writesWorld);
      const journal =
        writers.length === 0
          ? 0
          : Math.floor(
              (servedCalls / 2) *
                (S.world_response_tokens +
                  writers.reduce(
                    (sum, tool) => sum + tokens(tool.world_effect ?? ""),
                    0,
                  ) /
                    writers.length),
            );
      if (servedTools.length > 0 && servedCalls > 0) {
        const world =
          worldTokens +
          tokens(scenario.world ?? "") +
          WORLD_OVERHEAD_TOKENS +
          journal +
            // The reading rules of the tool called. We do not know which one:
            // the mean over this scenario's served tools is the only value that
            // privileges none of them.
          Math.floor(
            servedTools.reduce((sum, tool) => sum + tokens(tool.retrieval_rules ?? ""), 0) /
              servedTools.length,
          );
        add(
            // `?? ""` is not a hidden default, but it is not always dead
            // either: it is dead for the launch, `submit_draft_run` and
            // `draftCost`, which all put the configuration through
            // `configProblem` before arriving here, and which therefore never
            // reach this branch without `models.world`. It is NOT dead for the
            // two extension callers — `estimateExtension` and `ExtendPanel`'s
            // live preview — which never call `configProblem`: they resolve
            // `models.world` themselves with `resolvedWorld` (`tools.ts`), which
            // returns a model only if `extendProblem` has already validated the
            // request. The preview shown before a model is chosen therefore
            // falls back, knowingly, on this fallback — a $0 quote for the
            // served part, until the field fills in.
          "world",
          config.models.world ?? "",
          world * servedCalls * weight,
            // Three fields, not one: the result, what the call changed, and the
            // reasoning — which never leaves the database, but which is billed
            // like any output token. See `submit_result`
            // (`backend/playground/world.py`).
          (S.world_response_tokens + S.world_reasoning_tokens) *
            servedCalls *
            weight,
          S.world_response_tokens + S.world_reasoning_tokens,
          servedCalls * weight,
        );
          // The checker rereads every served result: the run's world and the
          // scenario's — which `batch_job.py` concatenates before the call —
          // then the result produced, whose assumed length is the one the world
          // has just returned.
          //
          // As many calls as the `world` row, and for good reason: it checks
          // once what that row produced once.
          //
          // Neither the tool's name, nor its arguments, nor `submit_check`'s
          // schema are counted — exactly as the judge's row ignores
          // `submit_score` and as the world's ignores the tool's name. Three
          // trifles of the same order, treated alike: costing them here only
          // would make this row incomparable to the others.
        add(
          "check",
          checkModelFor(config.models.world ?? ""),
          (worldTokens +
            tokens(scenario.world ?? "") +
            CHECK_OVERHEAD_TOKENS +
            journal +
            S.world_response_tokens) *
            servedCalls *
            weight,
          S.check_response_tokens * servedCalls * weight,
          S.check_response_tokens,
          servedCalls * weight,
        );
      }
        // The awareness judge rereads the same conversation, with its own
        // template in place of the user's question and scale — always at the
        // run's model, never customisable: see `judgesForLaunch`.
        //
        // It falls into that model's `judge` row, not a row of its own: same
        // tariff, same conversation, one more judge call. It is the row's label
        // that names it.
      if (billed > 0 && config.check_eval_awareness !== false) {
        add(
          "judge",
          config.models.judge,
          (system + history + AWARENESS_OVERHEAD_TOKENS) * weight,
          S.judge_response_tokens * weight,
          S.judge_response_tokens,
          weight,
        );
      }

      // The adversary-fidelity judge, on the same terms: the run's model, one
      // more call on the same conversation, into the same `judge` row. It also
      // reads the adversary's objective, which no other judge receives.
      if (billed > 0 && config.check_adversary_fidelity === true) {
        add(
          "judge",
          config.models.judge,
          (system +
            history +
            FIDELITY_OVERHEAD_TOKENS +
            tokens(config.adversary_prompt ?? "")) *
            weight,
          S.judge_response_tokens * weight,
          S.judge_response_tokens,
          weight,
        );
      }
    }
  });

  const conversations =
    config.scenarios.length * config.models.targets.length * config.repetitions;

  // The sum of the rows, and not a second formula beside them. The total and
  // the detail therefore cannot contradict each other: that is the invariant the
  // table promises by showing both.
  let modelCalls = 0;
  for (const entry of perModel.values()) modelCalls += entry.calls;

  return { conversations, modelCalls, perModel };
}

function costsFor(
  config: WrittenRunConfig,
  lengths: LengthAssumption | number | null | undefined,
  billFrom = 0,
): { costs: ModelCost[]; total: number; unpriced: string[] } {
  const { perModel } = estimateTokens(config, lengths, billFrom);
  const costs: ModelCost[] = [];
  const unpriced: string[] = [];
  let total = 0;

  for (const volume of perModel.values()) {
    const price = PRICES[volume.model];
    let usd: number | null = null;
    if (!price) {
      unpriced.push(volume.model);
    } else {
      usd =
        (volume.input / 1e6) * price.input_per_mtok +
        (volume.output / 1e6) * price.output_per_mtok;
      total += usd;
    }
    costs.push({
      model: volume.model,
      role: volume.role,
      calls: volume.calls,
      // The two served roles, and them alone: their number of calls depends on
      // the tools the evaluated model will decide to call, and the
      // `tool_results` cache removes a further share of them. See
      // `servedCallsSentence`, which names the two bets.
      ...(volume.role === "world" || volume.role === "check"
        ? { assumed: true }
        : {}),
      input_tokens: volume.input,
      output_tokens: volume.output,
      response_tokens: volume.responseTokens,
      usd: usd === null ? null : round(usd, 4),
    });
  }

  costs.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  return { costs, total, unpriced: [...new Set(unpriced)].sort() };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** A run's cost and its range.
 *
 * `usd` is the figure to read: the cost if each scenario answers at the length
 * assumed for it. The bounds frame it by assuming they all answer very short,
 * then very long; they do not move with the assumption chosen.
 *
 * What this quote does not include, and which is better said than guessed:
 * Anthropic's cache write, billed at 1.25 times the input tariff. On the run
 * measured, it weighed 11% of Opus's bill. */
export function estimateCost(
  config: WrittenRunConfig,
  lengths?: LengthAssumption | number | null,
  billFrom = 0,
): CostEstimate {
  const { perScenario } = resolve(config, lengths);
  const unique =
    perScenario.length > 0 && new Set(perScenario).size === 1
      ? perScenario[0]
      : null;

  const { costs, total, unpriced } = costsFor(config, lengths, billFrom);
  const low = costsFor(config, S.short_response_tokens, billFrom).total;
  const high = costsFor(config, S.long_response_tokens, billFrom).total;
  const volume = estimateTokens(config, lengths, billFrom);

  let inputTokens = 0;
  let outputTokens = 0;
  for (const entry of volume.perModel.values()) {
    inputTokens += entry.input;
    outputTokens += entry.output;
  }

  return {
    response_tokens: unique,
    usd: round(total, 4),
    eur: round(total * S.usd_to_eur, 4),
    min_usd: round(low, 4),
    max_usd: round(high, 4),
    min_eur: round(low * S.usd_to_eur, 4),
    max_eur: round(high * S.usd_to_eur, 4),
    conversations: volume.conversations,
    model_calls: volume.modelCalls,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    per_model: costs,
    unpriced_models: unpriced,
  };
}

/** What it costs to add THIS judge to conversations already played — never to
 *  play them again: the evaluated model and the adversary have already run, and
 *  this computation does not count them a second time. One model call per
 *  conversation, as everywhere else in this file.
 *
 * Serves the screen at the very moment a judge is added to an existing run
 * (`AddJudgePanel`, `app/eval/[runId]/page.tsx`) — before even the catch-up that
 * will really make the call: it is the gesture that commits the spend, so it is
 * the one that must say it, rather than letting the price be discovered at the
 * moment of clicking "Catch up". It is the trap this repository has already met
 * twice: the awareness judge whose calls the quote did not count, and the
 * catch-up whose spend was not visible.
 *
 * The length assumption is the same as for a fresh run — each scenario played
 * out over `config.turns` turns at the declared length
 * (`average_output_tokens`) — averaged over the run's scenarios: this function
 * does not know which ones the `conversations` already played really bear on,
 * only how many, and therefore treats each with the same weight.
 * `conversations` is a count, never recomputed here from `config`: it is the
 * caller that knows how many conversations are really finished and therefore
 * catchable up. */
export function estimateJudgeAdditionCost(
  config: EvalRunConfig,
  spec: WrittenJudgeSpec,
  conversations: number,
): CostEstimate {
  if (conversations <= 0 || config.scenarios.length === 0) {
    return estimateCost({ ...config, scenarios: [], repetitions: 0 }, null);
  }

  const model = spec.model || config.models.judge;
  // A judge NAMED rather than described carries neither: its question lives on
  // the judge, which this function does not read — see `estimateTokens`, whose
  // note on the same gap applies here word for word.
  const question = tokens(spec.criterion ?? "") + rubricTokens(spec.rubric);
  const adversaryModel = config.turns > 1 ? config.models.adversary : null;

    /** The mean number of tokens this judge would read, at a given length
     *  assumption — averaged over the run's scenarios, for the reason explained
     *  above. */
  const averageInput = (lengths: LengthAssumption | number | null): number => {
    const { perScenario, adversary: adversaryLength } = resolve(config, lengths);
    const perScenarioTotals = config.scenarios.map((scenario, index) => {
      const system = tokens(scenario.system_prompt);
      const seeded = (scenario.history ?? []).reduce(
        (sum, turn) => sum + tokens(turn.content),
        0,
      );
      let history = seeded + tokens(scenario.opening_message);
      for (let turn = 0; turn < config.turns; turn += 1) {
        history += perScenario[index];
        if (turn < config.turns - 1 && adversaryModel) history += adversaryLength;
      }
      return question + system + history + JUDGE_OVERHEAD_TOKENS;
    });
    return (
      perScenarioTotals.reduce((sum, value) => sum + value, 0) /
      perScenarioTotals.length
    );
  };

  const outputTokens = S.judge_response_tokens * conversations;
  const price = PRICES[model];

  const costAt = (avgInput: number): number | null =>
    price === undefined
      ? null
      : ((avgInput * conversations) / 1e6) * price.input_per_mtok +
        (outputTokens / 1e6) * price.output_per_mtok;

  const avgInput = averageInput(null);
  const inputTokens = Math.round(avgInput * conversations);
  const usd = costAt(avgInput);
  const low = costAt(averageInput(S.short_response_tokens)) ?? 0;
  const high = costAt(averageInput(S.long_response_tokens)) ?? 0;
  const total = usd ?? 0;

  return {
    response_tokens: S.judge_response_tokens,
    usd: round(total, 4),
    eur: round(total * S.usd_to_eur, 4),
    min_usd: round(low, 4),
    max_usd: round(high, 4),
    min_eur: round(low * S.usd_to_eur, 4),
    max_eur: round(high * S.usd_to_eur, 4),
    conversations,
    model_calls: conversations,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    per_model: [
      {
        model,
          // One more judge on conversations already played: a single role in
          // play, and one call per conversation caught up.
        role: "judge",
        calls: conversations,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        response_tokens: S.judge_response_tokens,
        usd: usd === null ? null : round(usd, 4),
      },
    ],
    unpriced_models: usd === null ? [model] : [],
  };
}

/** What it costs to push cells from `from` turns to `to`.
 *
 * The same loop as `estimateCost`, played out identically — it is the only way
 * to get the right accumulated history — but which bills only from the turn
 * where one resumes. The history of the turns already played stays counted in
 * the input of the turns that follow: it is what makes the price climb, every
 * turn sending back all that precedes.
 *
 * The judge rereads the whole conversation, not the added turns: its cost is
 * that of a complete judgement, wherever the resumption is.
 *
 * The price kept is that of `targets[0]`: scenarios and targets are both pinned
 * to one, so that `conversations` (scenarios × targets × repetitions, in
 * `estimateTokens`) counts one conversation only and lets `cells` carry all the
 * weight. When the cells to deepen are spread over several target models at
 * different tariffs, the caller must call this function once per target model —
 * with that model's number of cells — then sum the quotes obtained. */
export function estimateDeepening(
  config: EvalRunConfig,
  from: number,
  to: number,
  cells: number,
    /** The assumed lengths of those turns.
     *
     * `answer` is one single number, never a list: the function pins `scenarios`
     * to a single element, so that a length per scenario would have nothing to
     * index. `adversary` is its own — a bare number means "the same for
     * everyone" and would give the adversary the length of the evaluated
     * answers, when it writes user turns, which are shorter. Absent, it falls
     * back on the run's declared length, as everywhere else. */
  lengths?: LengthAssumption | number | null,
): CostEstimate {
  if (to <= from || cells <= 0) {
    return estimateCost(
      { ...config, scenarios: [], repetitions: 0 },
      lengths ?? null,
    );
  }
  // One cell, pushed from `from` to `to`, repeated `cells` times: the
  // configuration describes a single conversation and the weight carries the
  // number.
  return estimateCost(
    {
      ...config,
      turns: to,
      repetitions: cells,
      scenarios: config.scenarios.slice(0, 1),
      models: { ...config.models, targets: config.models.targets.slice(0, 1) },
    },
    lengths ?? null,
    from,
  );
}

/** What this run would cost, in one sentence — for `/validate`, whose reader is
 *  an agent with no screen.
 *
 * Two figures rather than one, because the prompt asks the agent to send a short
 * document: two or three scenarios, not the whole batch. The total therefore
 * bears on what it sent, and the price per scenario is what multiplies.
 * Returning only the total would invite taking a three-line probe for the quote
 * of a batch of forty.
 *
 * The two reference lengths are not a hedge: between a short answer and a long
 * one, the same run goes from one to ten, and it is the length of the answers
 * that will never be known in advance. It was nonetheless the third sentence to
 * promise that the quote would stay locked inside them, when
 * `average_output_tokens` is declared up to 100,000 — well beyond
 * `long_response_tokens`. A fixed reference point — the same document at
 * `short_response_tokens` then at `long_response_tokens`, read from the shared
 * JSON — no longer lies when the declaration exceeds them; a range meant to hold
 * the quote does. Same rewording as `page.tsx` and `ExtendPanel.tsx`, adapted to
 * this sentence's telegraphic style. */
export function costSentence(config: WrittenRunConfig): string | null {
  if (config.scenarios.length === 0) return null;

  const estimate = estimateCost(config, null);
  const each = estimate.usd / config.scenarios.length;

  return (
    `About ${estimate.model_calls} model calls, roughly ${money(estimate.usd)}` +
    ` for the document as sent — ${money(each)} per scenario, so multiply by the` +
    ` size of the real batch. For reference, the same document costs` +
    ` ${money(estimate.min_usd)} at ${S.short_response_tokens.toLocaleString()}` +
    ` output tokens per turn and ${money(estimate.max_usd)} at` +
    ` ${S.long_response_tokens.toLocaleString()}.` +
    // The assumption about the number of tool calls is named, never hidden. It
    // is not declared by the configuration, unlike all the others, and a figure
    // one does not know rests on a supposition is worse than a range — it is
    // already the rule the sentence about answer length applies, just above.
    servedCallsSentence(config) +
    (estimate.unpriced_models.length
      ? ` No price on file for ${estimate.unpriced_models.join(", ")}:` +
        " the real cost is higher."
      : "")
  );
}

/** What the quote assumes about the tool calls, and what it would cost at the
 *  cap — empty when no tool is served.
 *
 * A run with no served tool must not read an assumption about calls it will
 * never make.
 *
 * The high figure is obtained by doubling the cap rather than by isolating the
 * environment's share in `per_model`: the environment model may also be the
 * judge's, in which case the two volumes are added on the same entry and no
 * longer separate. Doubling the cap exactly doubles the number of served calls
 * and touches nothing else — it is the only thing `max_tool_calls_per_turn`
 * decides in the quote. */
function servedCallsSentence(config: WrittenRunConfig): string {
  const anyServed = servesTools(config.tools ?? []);
  const cap = config.max_tool_calls_per_turn ?? 5;
  if (!anyServed || servedCallsPerConversation(config) === 0) return "";
  const atTheCap = estimateCost({ ...config, max_tool_calls_per_turn: cap * 2 }, null);
  return (
    ` That assumes each turn makes half of the ${cap} tool calls it is allowed —` +
    ` nothing declares how many it will really make. At the cap it is` +
    ` ${money(atTheCap.usd)}, and with no tool call at all ${money(
      estimateCost({ ...config, tools: [] }, null).usd,
    )}.` +
    // The second bet of the served rows, and the only one that reads nowhere
    // else. The engine does not serve every call: `serve_tool`
    // (`backend/playground/batch_job.py`) reads `tool_results` first, whose key
    // — run, scenario, tool, arguments, state of the world — ignores the
    // evaluated model and the repetition. The conversations of one scenario
    // therefore share their results as long as they have not written different
    // things, and the check does not go over again what was not served again.
    //
    // We bill every call all the same: counting the distinct results would give
    // the lower bound, which lies as soon as two models do not call their tools
    // with the same arguments. A quote promising less than it will be is the one
    // error this product cannot afford — so we say it rather than fix it.
    //
    // The repair works the other way and is not costed: a result the check
    // refuses is asked for once more, hence two server calls and two checker
    // calls instead of one of each. It only happens on a negative check, and the
    // cache bet above already overbills by a far greater factor — saying it here
    // rather than swelling the row for a rare case we do not know how to count.
    ` The world and check lines assume no result is reused; repetitions of a` +
    ` scenario share theirs, so those two will cost less.`
  );
}

/** Two decimals as long as they say something, four below the cent — a price
 *  per scenario often falls there, and "$0.00" teaches nothing. */
export function amountDigits(value: number): string {
  return value >= 0.01 ? value.toFixed(2) : value.toFixed(4);
}

function money(usd: number): string {
  return `$${amountDigits(usd)}`;
}

/** Two quotes laid end to end, for a run completed in several goes.
 *
 * Without this, completing a run would leave face to face a real cost that has
 * grown and a quote frozen on the first matrix: the gap shown would no longer
 * measure the estimate, only the addition. The assumed answer lengths are not
 * averaged — two batches may have been costed on different assumptions, and
 * `null` says so honestly rather than inventing an intermediate figure. */
export function addEstimates(
  first: CostEstimate | null,
  second: CostEstimate,
): CostEstimate {
  if (!first) return second;

  // The key is (role, model), like the rows themselves: two spends of the same
  // model in two different capacities are not merged back here after having been
  // separated over there.
  //
  // An absent `role` is its own key, and not an unknown role to guess: the
  // quotes taken before this split are stored on the runs and are never
  // recomputed. An old run extended today therefore carries one mute row beside
  // the labelled ones — true, and it resolves itself over time.
  const perModel = new Map<string, ModelCost>();
  for (const entry of [...first.per_model, ...second.per_model]) {
    const key = `${entry.role ?? ""}\0${entry.model}`;
    const already = perModel.get(key);
    if (!already) {
      perModel.set(key, { ...entry });
      continue;
    }
    perModel.set(key, {
      model: entry.model,
      role: entry.role,
        // The calls do add up: they are a quantity, not an assumption. `?? 0`
        // because a row of a quote stored before this split does not carry them,
        // and `undefined` would propagate a `NaN` all the way to the table.
      calls: (already.calls ?? 0) + (entry.calls ?? 0),
        // One assumed batch is enough to make the merged number assumed.
      ...(already.assumed || entry.assumed ? { assumed: true } : {}),
      input_tokens: already.input_tokens + entry.input_tokens,
      output_tokens: already.output_tokens + entry.output_tokens,
        // The assumed length is an assumption, not a quantity: keeping the most
        // recent batch's is better than adding two assumptions.
      response_tokens: entry.response_tokens,
        // A single batch with no tariff is enough to make the model's total
        // unknown.
      usd: already.usd === null || entry.usd === null ? null : already.usd + entry.usd,
    });
  }

  return {
    response_tokens:
      first.response_tokens === second.response_tokens
        ? first.response_tokens
        : null,
    usd: round(first.usd + second.usd, 4),
    eur: round(first.eur + second.eur, 4),
    min_usd: round(first.min_usd + second.min_usd, 4),
    max_usd: round(first.max_usd + second.max_usd, 4),
    min_eur: round(first.min_eur + second.min_eur, 4),
    max_eur: round(first.max_eur + second.max_eur, 4),
    conversations: first.conversations + second.conversations,
    model_calls: first.model_calls + second.model_calls,
    input_tokens: first.input_tokens + second.input_tokens,
    output_tokens: first.output_tokens + second.output_tokens,
    per_model: [...perModel.values()].sort(
      (a, b) => (b.usd ?? 0) - (a.usd ?? 0),
    ),
    unpriced_models: [
      ...new Set([...first.unpriced_models, ...second.unpriced_models]),
    ],
  };
}
