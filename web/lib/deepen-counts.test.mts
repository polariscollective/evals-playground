// The counts the extension panel shows beside each level, and that of the
// selection it sends to the quote.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countAllGraded,
  countsByLevel,
  countsForSelection,
  estimateDeepeningCost,
  groupByModelAndDepth,
  samplesForSelection,
  type DeepenSample,
  type DeepenSampleWithDepth,
  type PrincipalVerdict,
} from "./deepen-counts.ts";
import { addEstimates, estimateDeepening } from "./pricing.ts";
import type { EvalRunConfig, JudgeScoreStatus, RubricLevel } from "./types.ts";

function verdict(
  score: number | null,
  status: JudgeScoreStatus = "done",
): PrincipalVerdict {
  return { status, score };
}

function sample(overrides: Partial<DeepenSampleWithDepth> = {}): DeepenSampleWithDepth {
  return {
    target_model: "anthropic/claude-haiku-4-5",
    status: "done",
    principal: verdict(0),
    turns_done: 4,
    ...overrides,
  };
}

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "Held out." },
  { value: 1, meaning: "Gave in." },
  { value: -1, meaning: "Not applicable.", excluded: true },
];

test("each level counts its attempts, broken down by model", () => {
  const samples = [
    sample({ principal: verdict(0), target_model: "a" }),
    sample({ principal: verdict(0), target_model: "a" }),
    sample({ principal: verdict(0), target_model: "b" }),
    sample({ principal: verdict(1), target_model: "a" }),
  ];
  const counts = countsByLevel(samples, RUBRIC);
  assert.equal(counts[0].total, 3);
  assert.deepEqual(counts[0].byModel, { a: 2, b: 1 });
  assert.equal(counts[1].total, 1);
  assert.deepEqual(counts[1].byModel, { a: 1 });
});

test("a level nobody carries stays at zero", () => {
  const counts = countsByLevel([sample({ principal: verdict(0) })], RUBRIC);
  assert.equal(counts[1].total, 0);
  assert.deepEqual(counts[1].byModel, {});
});

test("a level outside the mean still counts its attempts", () => {
  const counts = countsByLevel([sample({ principal: verdict(-1) })], RUBRIC);
  assert.equal(counts[2].total, 1);
});

test("attempts failed, waiting or ungraded count nowhere", () => {
  const samples: DeepenSample[] = [
    sample({ status: "error", principal: verdict(null, "pending") }),
    sample({ status: "pending", principal: verdict(null, "pending") }),
    // Empty conversation or grade off the scale: `done`, but with no grade.
    sample({ status: "done", principal: verdict(null, "done") }),
    // Played, but the principal has not passed over it yet.
    sample({ status: "done", principal: verdict(null, "pending") }),
    // The principal fell over on an otherwise valid conversation.
    sample({ status: "done", principal: verdict(null, "error") }),
  ];
  assert.deepEqual(
    countsByLevel(samples, RUBRIC).map((c) => c.total),
    [0, 0, 0],
  );
  assert.equal(countAllGraded(samples).total, 0);
});

test("\"all graded attempts\" covers every level, broken down by model", () => {
  const samples = [
    sample({ principal: verdict(0), target_model: "a" }),
    sample({ principal: verdict(1), target_model: "b" }),
    sample({ principal: verdict(-1), target_model: "a" }),
  ];
  const all = countAllGraded(samples);
  assert.equal(all.total, 3);
  assert.deepEqual(all.byModel, { a: 2, b: 1 });
});

test("a null selection deepens nothing", () => {
  const samples = [sample({ principal: verdict(0) })];
  assert.deepEqual(countsForSelection(samples, null), { total: 0, byModel: {} });
});

test("the \"all\" selection finds the same count as countAllGraded", () => {
  const samples = [
    sample({ principal: verdict(0), target_model: "a" }),
    sample({ principal: verdict(1), target_model: "b" }),
  ];
  assert.deepEqual(countsForSelection(samples, "all"), countAllGraded(samples));
});

test("a selection of grades takes only the attempts carrying them", () => {
  const samples = [
    sample({ principal: verdict(0), target_model: "a" }),
    sample({ principal: verdict(1), target_model: "b" }),
    sample({ principal: verdict(-1), target_model: "a" }),
  ];
  const selected = countsForSelection(samples, [0, -1]);
  assert.equal(selected.total, 2);
  assert.deepEqual(selected.byModel, { a: 2 });
});

// --- the quote for deepening, grouped by starting depth ----------------------
//
// After a first deepening, a run's attempts no longer all have the same depth:
// only the ones chosen grew. A quote that groups by model alone then treats
// everyone as though starting from `config.turns`, and under-bills the attempts
// left behind.

test("samplesForSelection returns the attempts themselves, not only their count", () => {
  const a = sample({ principal: verdict(0), target_model: "a", turns_done: 4 });
  const b = sample({ principal: verdict(1), target_model: "b", turns_done: 8 });
  assert.deepEqual(samplesForSelection([a, b], "all"), [a, b]);
  assert.deepEqual(samplesForSelection([a, b], [0]), [a]);
  assert.deepEqual(samplesForSelection([a, b], null), []);
});

test("the grouping separates two starting depths for one model", () => {
  const groups = groupByModelAndDepth(
    [
      { target_model: "a", turns_done: 4 },
      { target_model: "a", turns_done: 4 },
      { target_model: "a", turns_done: 8 },
      { target_model: "b", turns_done: 4 },
    ],
    4,
  );
  const byKey = Object.fromEntries(
    groups.map((g) => [`${g.target_model}@${g.turns_done}`, g.cells]),
  );
  assert.deepEqual(byKey, { "a@4": 2, "a@8": 1, "b@4": 1 });
});

test("an attempt with no recorded depth falls back on the fallback depth", () => {
  const groups = groupByModelAndDepth(
    [{ target_model: "a", turns_done: null }],
    4,
  );
  assert.deepEqual(groups, [{ target_model: "a", turns_done: 4, cells: 1 }]);
});

const DEEPEN_CONFIG: EvalRunConfig = {
  scenarios: [
    { title: "T", system_prompt: "You assist.", opening_message: "Do it." },
  ],
  criterion: "What it did.",
  rubric: [
    { value: 0, meaning: "Held out." },
    { value: 1, meaning: "Gave in." },
  ],
  // The run has already been through a first deepening: its official depth rose
  // to 8, but an attempt not chosen then stayed at 4.
  turns: 8,
  repetitions: 1,
  models: {
    targets: ["anthropic/claude-sonnet-5"],
    adversary: "anthropic/claude-sonnet-5",
    judge: "anthropic/claude-opus-5",
  },
  adversary_prompt: "Insist.",
};

test("the quote charges each group from its real starting depth", () => {
  const cells = [
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 4 },
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 8 },
  ];
  const correct = estimateDeepeningCost(DEEPEN_CONFIG, cells, 12, DEEPEN_CONFIG.turns);
  const expected = addEstimates(
    estimateDeepening(DEEPEN_CONFIG, 4, 12, 1),
    estimateDeepening(DEEPEN_CONFIG, 8, 12, 1),
  );
  assert.deepEqual(correct, expected);
});

test("grouping by model alone would underestimate the attempt left behind", () => {
  // The fault that was fixed: treating both attempts as though they all started
  // from `config.turns` (8) would charge less than what really remains to be
  // played for the one that never moved from 4.
  const cells = [
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 4 },
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 8 },
  ];
  const correct = estimateDeepeningCost(DEEPEN_CONFIG, cells, 12, DEEPEN_CONFIG.turns)!;
  const underestimated = estimateDeepening(DEEPEN_CONFIG, DEEPEN_CONFIG.turns, 12, cells.length);
  assert.ok(
    correct.usd > underestimated.usd,
    `the correct quote (${correct.usd}) should exceed the one grouped by model alone (${underestimated.usd})`,
  );
});

test("with no attempt to deepen, no quote", () => {
  assert.equal(estimateDeepeningCost(DEEPEN_CONFIG, [], 12, DEEPEN_CONFIG.turns), null);
});
