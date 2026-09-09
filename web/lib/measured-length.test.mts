// What a finished run can say about the length of its answers.
//
// The point to protect is the denominator: it is the depth, not the number of
// calls really billed. The estimator counts only one call of the evaluated model
// per conversation turn; dividing by anything else would make it return a total
// different from the one observed.
//
// And it is the depth *of the cell*, `turns_done`, not the one the run shows: an
// extension raises `turns` for everyone and deepens only the chosen cells.
import { test } from "node:test";
import assert from "node:assert/strict";
import { measureRun, answerLengthsFor } from "./measured-length.ts";
import { estimateTokens, roleKey } from "./pricing.ts";
import { SHARED_PRICING } from "./shared.ts";
import type { EvalModels, EvalRunConfig, ModelUsage } from "./types.ts";

const MODELS: EvalModels = {
  targets: ["anthropic/claude-sonnet-5", "grok/grok-4.3"],
  adversary: "anthropic/claude-haiku-4-5",
  judge: "openai/gpt-5.6-luna",
};

const usage = (counts: Record<string, number>): Record<string, ModelUsage> =>
  Object.fromEntries(
    Object.entries(counts).map(([model, output]) => [
      model,
      {
        input_tokens: 0,
        output_tokens: output,
        input_tokens_cache_read: 0,
        input_tokens_cache_write: 0,
        reasoning_tokens: 0,
      },
    ]),
  );

/** A played cell. `turns_done` at `null` by default: it is the row written
 *  before the column existed, the one that must fall back on the run's depth.
 *  The cells that have a depth of their own name it. */
const cell = (
  scenario_index: number,
  target_model: string,
  output: number,
  extra: Record<string, number> = {},
  turns_done: number | null = null,
) => ({
  scenario_index,
  target_model,
  status: "done" as const,
  turns_done,
  usage: usage({ [target_model]: output, ...extra }),
});

test("a clean cell returns its output tokens divided by the turns", () => {
  const measured = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000)],
    MODELS,
    3,
  );
  assert.equal(measured.byScenario.get(0), 1000);
});

test("two cells of the same scenario are pooled", () => {
  // 3000 + 1000 tokens for 2 cells × 2 turns = 1000 per turn.
  const measured = measureRun(
    [
      cell(0, "anthropic/claude-sonnet-5", 3000),
      cell(0, "grok/grok-4.3", 1000),
    ],
    MODELS,
    2,
  );
  assert.equal(measured.byScenario.get(0), 1000);
});

test("the run's mean is pooled, not a mean of means", () => {
  // Scenario 0 is played twice at 100, scenario 1 once at 4000.
  // Pooled: (100 + 100 + 4000) / 3 cells = 1400 per turn.
  // A mean of means would give (100 + 4000) / 2 = 2050.
  const measured = measureRun(
    [
      cell(0, "anthropic/claude-sonnet-5", 100),
      cell(0, "grok/grok-4.3", 100),
      cell(1, "anthropic/claude-sonnet-5", 4000),
    ],
    MODELS,
    1,
  );
  assert.equal(measured.run, 1400);
});

test("a cell whose evaluated model is also the judge is set aside", () => {
  const models: EvalModels = { ...MODELS, judge: "anthropic/claude-sonnet-5" };
  const measured = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000), cell(0, "grok/grok-4.3", 300)],
    models,
    1,
  );
  assert.equal(measured.byScenario.get(0), 300);
  assert.equal(measured.skipped, 1);
});

test("a cell whose evaluated model is also the adversary is set aside", () => {
  const models: EvalModels = {
    ...MODELS,
    adversary: "anthropic/claude-sonnet-5",
  };
  const measured = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000), cell(0, "grok/grok-4.3", 300)],
    models,
    1,
  );
  assert.equal(measured.byScenario.get(0), 300);
  assert.equal(measured.skipped, 1);
});

test("a measurable adversary returns a non-null length (positive control)", () => {
  // No role overlaps here: it serves as a control for the two tests that follow,
  // which return `null` for want of an adversary distinct from the other roles —
  // without it, a `measureRun` that always returned `null` would still pass.
  const cells = [
    cell(0, "grok/grok-4.3", 500, { "anthropic/claude-haiku-4-5": 1200 }),
  ];
  assert.equal(measureRun(cells, MODELS, 3).adversary, 600);
});

test("an adversary that is also a target is not measurable", () => {
  const models: EvalModels = { ...MODELS, adversary: "grok/grok-4.3" };
  const cells = [cell(0, "grok/grok-4.3", 1200)];
  assert.equal(measureRun(cells, models, 3).adversary, null);
});

test("an adversary that is also the judge is not measurable", () => {
  const models: EvalModels = { ...MODELS, judge: "anthropic/claude-haiku-4-5" };
  const cells = [
    cell(0, "grok/grok-4.3", 500, { "anthropic/claude-haiku-4-5": 1200 }),
  ];
  assert.equal(measureRun(cells, models, 3).adversary, null);
});

test("the unfinished cells do not count", () => {
  const cells = [
    { ...cell(0, "grok/grok-4.3", 500), status: "error" as const },
    { ...cell(0, "grok/grok-4.3", 500), status: "pending" as const },
    { ...cell(0, "grok/grok-4.3", 500), status: "cancelled" as const },
  ];
  const measured = measureRun(cells, MODELS, 1);
  assert.equal(measured.byScenario.size, 0);
  assert.equal(measured.run, null);
  // Set aside because unfinished, not because a model held several roles.
  assert.equal(measured.skipped, 0);
});

test("a cell with no recorded usage does not count", () => {
  const measured = measureRun(
    [
      {
        scenario_index: 0,
        target_model: "grok/grok-4.3",
        status: "done" as const,
        turns_done: 1,
        usage: {},
      },
    ],
    MODELS,
    1,
  );
  assert.equal(measured.run, null);
  // Mute, not set aside: it must weigh down neither the role-overlap counter nor
  // the count of cells that carried the measurement.
  assert.equal(measured.kept, 0);
  assert.equal(measured.skipped, 0);
});

test("the adversary is measured over turns − 1 calls per cell", () => {
  // 900 adversary tokens, 1 cell, 4 turns → 3 calls → 300 per call.
  const cells = [
    cell(0, "grok/grok-4.3", 1200, { "anthropic/claude-haiku-4-5": 900 }),
  ];
  assert.equal(measureRun(cells, MODELS, 4).adversary, 300);
});

test("each cell is divided by its own depth, not by the run's", () => {
  // The run played ten cells at 3 turns, 1000 tokens per turn. An extension took
  // `turns` to 6 and deepened two of them, which therefore spent 6000 tokens.
  // Dividing everyone by 6 would return 600 — 40% under the truth, and in
  // silence.
  const cells = [
    ...Array.from({ length: 8 }, () =>
      cell(0, "grok/grok-4.3", 3000, {}, 3),
    ),
    ...Array.from({ length: 2 }, () =>
      cell(0, "grok/grok-4.3", 6000, {}, 6),
    ),
  ];
  assert.equal(measureRun(cells, MODELS, 6).run, 1000);
});

test("a cell with no recorded depth falls back on the run's", () => {
  // The column is more recent than the first cells: without it, the run's depth
  // is the best information available — same fallback as
  // `groupByModelAndDepth`.
  const cells = [cell(0, "grok/grok-4.3", 3000, {}, null)];
  assert.equal(measureRun(cells, MODELS, 3).run, 1000);
});

test("the adversary is also counted on its cell's depth", () => {
  // A cell left at 3 turns made the adversary speak twice, the one pushed to 6
  // made it speak five times: 600 + 1500 tokens for 7 pushes → 300.
  const cells = [
    cell(0, "grok/grok-4.3", 3000, { "anthropic/claude-haiku-4-5": 600 }, 3),
    cell(0, "grok/grok-4.3", 6000, { "anthropic/claude-haiku-4-5": 1500 }, 6),
  ];
  assert.equal(measureRun(cells, MODELS, 6).adversary, 300);
});

test("a cell settled at the first turn does not make the adversary speak", () => {
  // Zero pushes: counting it would divide by zero. It is mute on the adversary,
  // not null.
  const cells = [
    cell(0, "grok/grok-4.3", 1000, { "anthropic/claude-haiku-4-5": 400 }, 1),
    cell(0, "grok/grok-4.3", 3000, { "anthropic/claude-haiku-4-5": 600 }, 3),
  ];
  assert.equal(measureRun(cells, MODELS, 3).adversary, 300);
});

test("at a single turn, the adversary is not measurable", () => {
  const cells = [cell(0, "grok/grok-4.3", 1200)];
  assert.equal(measureRun(cells, MODELS, 1).adversary, null);
});

test("a measured scenario takes its measurement, a fresh scenario the run's", () => {
  const measured = measureRun(
    [
      cell(0, "grok/grok-4.3", 100),
      cell(1, "grok/grok-4.3", 4000),
    ],
    MODELS,
    1,
  );
  // Scenario 0 measured, scenario 7 never played → the run's mean, 2050.
  assert.deepEqual(answerLengthsFor([0, 7], measured, 800), [100, 2050]);
});

test("with no clean cell at all, we fall back on the declared length", () => {
  const empty = measureRun([], MODELS, 3);
  assert.deepEqual(answerLengthsFor([0, 1], empty, 800), [800, 800]);
});

test("with no declaration either, we fall back on the general average", () => {
  const empty = measureRun([], MODELS, 3);
  assert.deepEqual(answerLengthsFor([0], empty, undefined), [
    SHARED_PRICING.default_response_tokens,
  ]);
});

test("the count of cells kept is returned with the measurement", () => {
  const measured = measureRun(
    [cell(0, "grok/grok-4.3", 100), cell(1, "grok/grok-4.3", 200)],
    MODELS,
    1,
  );
  assert.equal(measured.kept, 2);
  assert.equal(measured.skipped, 0);
});

test("the quote reproduces exactly the output tokens observed", () => {
  // The project's central promise, and it was checked nowhere: what comes out of
  // the measurement, handed back to the estimator, lands on the total really
  // billed — including when tool calls made more calls than turns get paid for.
  // That is what dividing by the turns, and not by the calls, buys.
  //
  // Two cells of scenario 0, at 3 turns: 6000 and 3000 output tokens. The first
  // needed five model calls for its three turns, the second three — `usage`
  // keeps no trace of that, and it is precisely why the denominator cannot be
  // the number of calls.
  const observed = [6000, 3000];
  const cells = observed.map((tokens) =>
    cell(0, "grok/grok-4.3", tokens, {}, 3),
  );
  const measured = measureRun(cells, MODELS, 3);

  const config = {
    scenarios: [
      {
        title: "Archives",
        system_prompt: "You manage the archives.",
        opening_message: "Find the March file.",
      },
    ],
    criterion: "Did it find the file?",
    rubric: [
      { value: 0, meaning: "No." },
      { value: 1, meaning: "Yes." },
    ],
    turns: 3,
    // As many conversations as cells measured: the quote then bears on exactly
    // what was observed.
    repetitions: observed.length,
    models: {
      targets: ["grok/grok-4.3"],
      adversary: MODELS.adversary,
      judge: MODELS.judge,
    },
    adversary_prompt: "Insist.",
    tools: [
      {
        name: "search",
        description: "Searches for a file by month.",
        parameters: [
          { name: "month", type: "string", description: "The month wanted." },
        ],
        result: "march-file",
      },
    ],
  } as EvalRunConfig;

  const { perModel } = estimateTokens(config, {
    answer: answerLengthsFor([0], measured, undefined),
    adversary: measured.adversary,
  });

  // The evaluated role's row, and not the model's: `perModel` is keyed by
  // (role, model) since the quote was split by role. Here grok holds only one,
  // but aiming at the role is what makes the assertion right even the day the
  // same model also judged — it is indeed the *evaluated* model's output that
  // the measurement claims to reproduce, not the sum of its capacities.
  assert.equal(
    perModel.get(roleKey("evaluated", "grok/grok-4.3"))?.output,
    observed.reduce((total, tokens) => total + tokens, 0),
  );
});

test("a total of zero tokens is not a measurement", () => {
  // The output was blocked from end to end: the run has not learned that answers
  // are free, it has learned nothing. Keeping zero would cost the extension at
  // one token per turn, `clamp` raising the zero to one.
  const measured = measureRun([cell(0, "grok/grok-4.3", 0, {}, 3)], MODELS, 3);
  assert.equal(measured.run, null);
  assert.equal(measured.byScenario.get(0), undefined);
  assert.deepEqual(answerLengthsFor([0], measured, 800), [800]);
});

test("an entirely mute adversary is not measured at zero either", () => {
  const cells = [
    cell(0, "grok/grok-4.3", 3000, { "anthropic/claude-haiku-4-5": 0 }, 3),
  ];
  assert.equal(measureRun(cells, MODELS, 3).adversary, null);
});

test("a mean that rounds to zero is not a measurement either", () => {
  // 10 cells at 3 turns (30 calls in all) for 14 output tokens in total: the
  // total is not null, but 14 / 30 rounds to 0. Keeping it would cost the
  // extension at one token per turn — `clamp` raising the zero to one — under the
  // same "0 output tokens per turn" sentence as the null total, by another
  // route.
  const cells = [
    cell(0, "grok/grok-4.3", 14, {}, 3),
    ...Array.from({ length: 9 }, () => cell(0, "grok/grok-4.3", 0, {}, 3)),
  ];
  const measured = measureRun(cells, MODELS, 3);
  assert.equal(measured.run, null);
  assert.equal(measured.byScenario.get(0), undefined);
  assert.equal(measured.kept, 10);
  assert.deepEqual(answerLengthsFor([0], measured, 800), [800]);
});

test("a single cell at zero does not silence the others", () => {
  // The zero does enter the pool: it is the entirely null pool that says nothing,
  // not the isolated cell that drags the mean down.
  const cells = [
    cell(0, "grok/grok-4.3", 0, {}, 3),
    cell(0, "grok/grok-4.3", 6000, {}, 3),
  ];
  assert.equal(measureRun(cells, MODELS, 3).run, 1000);
});
