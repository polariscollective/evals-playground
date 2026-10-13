// What an import expects of a draft, and the skeleton handed to the agent that
// fills it. Pure, like cells.test.mts: nothing here touches Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellKey,
  extensionExpectation,
  importSkeleton,
  judgeKey,
  launchJudgeKeys,
  runExpectation,
} from "./import-results.ts";
import { judgesForLaunch } from "./launch-judges.ts";
import type { EvalRunConfig, Judge, RubricLevel } from "./types";

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "No." },
  { value: 1, meaning: "Yes." },
];
const AWAKE_RUBRIC: RubricLevel[] = Array.from({ length: 10 }, (_, i) => ({
  value: i + 1,
  meaning: `Level ${i + 1}.`,
}));

function config(overrides: Partial<EvalRunConfig> = {}): EvalRunConfig {
  return {
    scenarios: [
      { title: "A", system_prompt: "p", opening_message: "hi" },
      { title: "B", system_prompt: "p", opening_message: "hi" },
    ],
    criterion: "Did the model give in?",
    rubric: RUBRIC,
    turns: 2,
    repetitions: 2,
    models: { targets: ["a/1", "b/1"], judge: "judge/1" },
    adversary_prompt: "",
    ...overrides,
  };
}

function seeded(id: string, type: "awake" | "faithful_adversary"): Judge {
  return {
    id,
    label: id,
    slug: id,
    criterion: null,
    rubric: AWAKE_RUBRIC,
    grades: "assistant",
    sees_adversary_goals: false,
    higher_is_better: false,
    system_type: type,
    sees_system_prompt: true,
    created_by: "seed",
    created_at: "2026-09-10T00:00:00Z",
  } as Judge;
}

test("a run draft expects every cell of its matrix", () => {
  const expectation = runExpectation(config(), { awake: { rubric: AWAKE_RUBRIC } });
  assert.equal(expectation.cells.length, 2 * 2 * 2);
  assert.deepEqual(
    expectation.cells.map(cellKey).slice(0, 2),
    ["0|a/1|0", "0|a/1|1"],
  );
  assert.equal(expectation.turns, 2);
  assert.deepEqual(expectation.conversations, []);
  assert.deepEqual(expectation.newJudges, []);
});

test("a run draft's judges are the principal, its judges in order, then the checks it turns on", () => {
  const expectation = runExpectation(
    config({
      judges: [{ criterion: "Second?", rubric: [{ value: 5, meaning: "Five." }] }],
      check_adversary_fidelity: true,
    }),
    {
      awake: { rubric: AWAKE_RUBRIC },
      faithful_adversary: { rubric: [{ value: 1, meaning: "One." }] },
    },
  );
  assert.deepEqual(expectation.judges, [
    { key: "principal", scale: [0, 1] },
    { key: "judges[0]", scale: [5] },
    { key: "awareness", scale: AWAKE_RUBRIC.map((level) => level.value) },
    { key: "adversary_fidelity", scale: [1] },
  ]);
});

test("the awareness check is expected only when it is on", () => {
  const expectation = runExpectation(config({ check_eval_awareness: false }), {});
  assert.deepEqual(expectation.judges.map((judge) => judge.key), ["principal"]);
});

test("the keys of a fresh run's links follow judgesForLaunch's order", () => {
  const written = config({
    judges: [
      { criterion: "Second?", rubric: RUBRIC },
      { criterion: "Third?", rubric: RUBRIC },
    ],
  });
  let next = 0;
  const { runJudges } = judgesForLaunch(
    written,
    "run-1",
    "me@example.com",
    [],
    { labels: new Set(), slugs: new Set() },
    { principal: null, secondary: [], system: { awake: seeded("awake-1", "awake") } },
    () => `id-${next++}`,
  );
  const keys = launchJudgeKeys(runJudges);
  assert.deepEqual([...keys.keys()], ["principal", "judges[0]", "judges[1]", "awareness"]);
  assert.equal(keys.get("principal"), runJudges[0].id);
  assert.equal(keys.get("awareness"), runJudges[3].id);
});

test("on a run that exists, an ordinary judge is named by its slug", () => {
  assert.equal(
    judgeKey({ is_principal: true, system_type: "ordinary", judge: { slug: "x" } }),
    "principal",
  );
  assert.equal(
    judgeKey({ is_principal: false, system_type: "awake", judge: { slug: "eval-awareness" } }),
    "awareness",
  );
  assert.equal(
    judgeKey({ is_principal: false, system_type: "ordinary", judge: { slug: "refusal-tone" } }),
    "refusal-tone",
  );
});

test("an extension adding cells expects its new cells and its deepened ones", () => {
  const expectation = extensionExpectation({
    cases: [
      { scenario_index: 2, scenario_title: "C", target_model: "a/1", repetition: 0, temperature: null },
    ],
    deepened: [{ scenario_index: 0, target_model: "a/1", repetition: 1, temperature: 0.5 }],
    turns: 4,
    liveJudges: [
      { is_principal: true, system_type: "ordinary", judge: { slug: "p", rubric: RUBRIC } },
      { is_principal: false, system_type: "awake", judge: { slug: "w", rubric: AWAKE_RUBRIC } },
    ],
    newJudgeScales: [],
    doneConversations: [],
  });
  assert.deepEqual(expectation.cells, [
    { scenario_index: 2, target_model: "a/1", repetition: 0, temperature: null },
    { scenario_index: 0, target_model: "a/1", repetition: 1, temperature: 0.5 },
  ]);
  assert.equal(expectation.turns, 4);
  assert.deepEqual(expectation.judges.map((judge) => judge.key), ["principal", "awareness"]);
});

test("an extension adding judges expects their grades on every finished conversation", () => {
  const done = [{ scenario_index: 0, target_model: "a/1", repetition: 0 }];
  const expectation = extensionExpectation({
    cases: [],
    deepened: [],
    turns: 2,
    liveJudges: [],
    newJudgeScales: [[0, 1, 2]],
    doneConversations: done,
  });
  assert.deepEqual(expectation.cells, []);
  assert.deepEqual(expectation.conversations, done);
  assert.deepEqual(expectation.newJudges, [{ key: "new_judges[0]", scale: [0, 1, 2] }]);
});

test("the skeleton leaves every grade null, never a grade of nothing", () => {
  const skeleton = importSkeleton(
    runExpectation(config({ repetitions: 1, models: { targets: ["a/1"], judge: "j/1" } }), {
      awake: { rubric: AWAKE_RUBRIC },
    }),
  );
  assert.equal(skeleton.cells.length, 2);
  assert.deepEqual(skeleton.cells[0], {
    scenario_index: 0,
    target_model: "a/1",
    repetition: 0,
    temperature: null,
    turns_done: null,
    messages: [],
    cost_usd: null,
    grades: { principal: null, awareness: null },
  });
  assert.deepEqual(skeleton.grades, []);
  assert.equal(skeleton.cost_usd, null);
});

test("the skeleton of a judge extension lists one null grade per judge and conversation", () => {
  const skeleton = importSkeleton({
    cells: [],
    turns: 2,
    judges: [],
    conversations: [{ scenario_index: 0, target_model: "a/1", repetition: 0 }],
    newJudges: [{ key: "new_judges[0]", scale: [0, 1] }],
  });
  assert.deepEqual(skeleton.grades, [
    { scenario_index: 0, target_model: "a/1", repetition: 0, judge: "new_judges[0]", grade: null },
  ]);
});
