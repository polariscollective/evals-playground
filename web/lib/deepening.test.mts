// Deepening is the dearest thing this product knows how to do: a wrong price
// here would be worse than no price at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, estimateDeepening } from "./pricing.ts";
import type { CostEstimate, EvalRunConfig } from "./types";

const CONFIG = {
  scenarios: [
    { title: "T", system_prompt: "You assist.", opening_message: "Do it." },
  ],
  criterion: "What it did.",
  rubric: [
    { value: 0, meaning: "Held." },
    { value: 1, meaning: "Gave way." },
  ],
  turns: 4,
  repetitions: 1,
  // The judge carries a model different from the evaluated one and from the
  // adversary. It is no longer a necessity — `per_model` is keyed by (role,
  // model) since the quote was split by role, and a model holding several roles
  // now returns one row per capacity — but it stays more readable: one reads the
  // judge's row without having to filter on its role. An expensive pair (sonnet /
  // opus, rather than haiku everywhere) also stops a rounding to four decimals on
  // an amount of a few cents skewing the ×10 comparison of the test "the quote
  // follows the number of cells".
  models: {
    targets: ["anthropic/claude-sonnet-5"],
    adversary: "anthropic/claude-sonnet-5",
    judge: "anthropic/claude-opus-5",
  },
  adversary_prompt: "Insist.",
} as EvalRunConfig;

test("continuing costs less than replaying from the start", () => {
  // That is the whole point: the turns already played are not paid for again.
  const fresh = estimateCost({ ...CONFIG, turns: 8 }, null);
  const continued = estimateDeepening(CONFIG, 4, 8, 1);
  assert.ok(
    continued.usd < fresh.usd,
    `continuing (${continued.usd}) should cost less than replaying (${fresh.usd})`,
  );
});

test("continuing costs more than the same turns played cold", () => {
  // Every turn sends the whole history back: resuming at four turns already drags
  // four turns of conversation, where a fresh four-turn run starts from nothing.
  // A quote that ignored it would underestimate the product's one expensive
  // feature.
  const cold = estimateCost({ ...CONFIG, turns: 4 }, null);
  const continued = estimateDeepening(CONFIG, 4, 8, 1);
  assert.ok(
    continued.usd > cold.usd,
    `continuing (${continued.usd}) should cost more than four turns cold (${cold.usd})`,
  );
});

test("the judge is paid for the whole conversation, not for the added turns", () => {
  // It rereads everything: its cost does not depend on where the resumption
  // happened. Deepening to eight turns and playing eight turns fresh give it the
  // same conversation to read, hence the same bill — which is what distinguishes
  // its cost from that of the models, which does lighten with a resumption.
  const fresh = estimateCost({ ...CONFIG, turns: 8 }, null);
  const continued = estimateDeepening(CONFIG, 4, 8, 1);
  const judge = (e: typeof fresh) =>
    e.per_model.filter((m) => m.model === CONFIG.models.judge);

  // The judge appears once per conversation in both quotes.
  assert.equal(judge(continued).length, judge(fresh).length);
  assert.equal(
    judge(continued)[0].input_tokens,
    judge(fresh)[0].input_tokens,
    "the judge rereads the same conversation in both cases",
  );
});

test("the quote follows the number of cells", () => {
  const one = estimateDeepening(CONFIG, 4, 8, 1);
  const ten = estimateDeepening(CONFIG, 4, 8, 10);
  assert.ok(Math.abs(ten.usd - one.usd * 10) < one.usd * 0.001);
  assert.equal(ten.conversations, 10);
});

test("deepening by zero turns costs nothing", () => {
  const nothing = estimateDeepening(CONFIG, 4, 4, 5);
  assert.equal(nothing.usd, 0);
  assert.equal(nothing.model_calls, 0);
});

test("the quote counts one target only even if the configuration offers several", () => {
  // `conversations = scenarios × targets × repetitions` in `estimateTokens`.
  // Deepening already pins the scenarios to one; it must pin the targets the same
  // way, otherwise a run with several target models multiplies the quote by their
  // number instead of counting one conversation per cell.
  const config = {
    ...CONFIG,
    models: {
      ...CONFIG.models,
      targets: ["anthropic/claude-sonnet-5", "anthropic/claude-opus-5"],
    },
  };
  const estimate = estimateDeepening(config, 4, 8, 5);
  assert.equal(estimate.conversations, 5);
});

test("the billed calls count the added turns, not the total depth", () => {
  // A non-obvious path: at repetitions = 1 and a single target, `conversations`
  // is 1, so `model_calls` carries `callsPerConversation` directly. A formula
  // billing `config.turns` (the total depth, 8) instead of the turns really
  // billed (4, from 4 to 8) would give the same value here as for a fresh
  // eight-turn run — it is that confusion the test rules out by asserting both
  // numbers, distinct, in the same test.
  const continued = estimateDeepening(CONFIG, 4, 8, 1);
  const fresh = estimateCost({ ...CONFIG, turns: 8 }, null);

  // 4 turns billed: 4 calls to the target, and as many to the adversary — the
  // resumption's opening push adds itself to the 3 ordinary pushes, since the
  // target does not answer after its own last turn — plus 1 to the judge, plus 1
  // to the awareness judge, on by default.
  assert.equal(continued.model_calls, 10);
  // A fresh eight-turn run bills the whole depth: 8 + 7 + 1 + 1. Its last push
  // still does not happen, unlike a continuation.
  assert.equal(fresh.model_calls, 17);
});

/** The same configuration, but with three distinct models: without which the
 *  adversary's row would merge with the evaluated model's, and nothing would say
 *  which length each was given. */
const THREE_ROLES = {
  ...CONFIG,
  models: {
    targets: ["anthropic/claude-sonnet-5"],
    adversary: "anthropic/claude-haiku-4-5",
    judge: "anthropic/claude-opus-5",
  },
  average_output_tokens: 700,
} as EvalRunConfig;

const rowOf = (estimate: CostEstimate, model: string) =>
  estimate.per_model.find((entry) => entry.model === model);

test("the adversary is costed at its own length, not at the evaluated model's", () => {
  // A bare number means "the same for everyone": it gave the adversary the length
  // of the evaluated answers, when it writes user turns — shorter, and measured
  // apart.
  const own = estimateDeepening(THREE_ROLES, 3, 6, 4, {
    answer: 1500,
    adversary: 300,
  });
  const borrowed = estimateDeepening(THREE_ROLES, 3, 6, 4, 1500);

  assert.equal(rowOf(own, "anthropic/claude-haiku-4-5")?.response_tokens, 300);
  assert.equal(rowOf(borrowed, "anthropic/claude-haiku-4-5")?.response_tokens, 1500);
  assert.ok(
    own.usd < borrowed.usd,
    `${own.usd} should stay under ${borrowed.usd}`,
  );
  // The evaluated model, for its part, is costed the same in both: only the
  // adversary changed length.
  assert.equal(
    rowOf(own, "anthropic/claude-sonnet-5")?.response_tokens,
    rowOf(borrowed, "anthropic/claude-sonnet-5")?.response_tokens,
  );
});

test("for want of a measurement, the adversary falls back on the run's declared length", () => {
  const quote = estimateDeepening(THREE_ROLES, 3, 6, 1, {
    answer: 1500,
    adversary: null,
  });
  assert.equal(rowOf(quote, "anthropic/claude-haiku-4-5")?.response_tokens, 700);
  assert.equal(rowOf(quote, "anthropic/claude-sonnet-5")?.response_tokens, 1500);
});
