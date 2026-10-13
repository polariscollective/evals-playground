// What an import expects of a draft, and the skeleton handed to the agent that
// fills it. Pure, like cells.test.mts: nothing here touches Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCosts,
  cellKey,
  checkImport,
  extensionExpectation,
  importCost,
  importSkeleton,
  importSummary,
  importWrites,
  judgeKey,
  launchJudgeKeys,
  playedElsewhereProblem,
  playedHereProblem,
  runExpectation,
  type ImportExpectation,
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

const EXPECT: ImportExpectation = {
  cells: [
    { scenario_index: 0, target_model: "a/1", repetition: 0, temperature: null },
    { scenario_index: 0, target_model: "a/1", repetition: 1, temperature: null },
  ],
  turns: 2,
  judges: [
    { key: "principal", scale: [0, 1] },
    { key: "awareness", scale: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
  ],
  conversations: [],
  newJudges: [],
};

const PLAYED = {
  scenario_index: 0,
  target_model: "a/1",
  repetition: 0,
  turns_done: 1,
  messages: [
    { role: "user", content: "hi" },
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "c1", name: "lookup", arguments: { q: "x" } }],
    },
    { role: "tool", content: "found", tool_name: "lookup", tool_call_id: "c1" },
    { role: "assistant", content: "Done." },
  ],
  grades: { principal: { score: 1, justification: "at turn 1" }, awareness: null },
};
const FAILED = {
  scenario_index: 0,
  target_model: "a/1",
  repetition: 1,
  error: "The provider refused the request.",
};

function check(doc: unknown, expectation = EXPECT) {
  return checkImport(JSON.stringify(doc), expectation);
}

function problems(doc: unknown, expectation = EXPECT): string {
  const result = check(doc, expectation);
  assert.ok("problems" in result, "expected a refusal");
  return result.problems.join("\n");
}

test("a document covering every cell passes", () => {
  const result = check({ cells: [PLAYED, FAILED] });
  assert.ok("doc" in result);
  assert.equal(result.doc.cells.length, 2);
  assert.deepEqual(result.doc.grades, []);
});

test("text that is not JSON is refused", () => {
  const result = checkImport("{cells:", EXPECT);
  assert.ok("problems" in result);
  assert.match(result.problems[0], /not valid JSON/);
});

test("a missing cell is refused and named", () => {
  assert.match(problems({ cells: [PLAYED] }), /Missing.*repetition 1/);
});

test("a cell the draft does not hold is refused", () => {
  assert.match(
    problems({ cells: [PLAYED, FAILED, { ...FAILED, target_model: "z/9" }] }),
    /Not part of this draft: scenario 0, z\/9, repetition 1/,
  );
});

test("a cell given twice is refused", () => {
  assert.match(problems({ cells: [PLAYED, FAILED, FAILED] }), /appears twice/);
});

test("a cell both played and failed is refused, and so is one neither", () => {
  assert.match(problems({ cells: [PLAYED, { ...FAILED, messages: PLAYED.messages }] }), /both messages and an error/);
  assert.match(problems({ cells: [PLAYED, { ...FAILED, error: undefined }] }), /neither messages nor an error/);
});

test("a temperature other than the planned one is refused", () => {
  assert.match(problems({ cells: [{ ...PLAYED, temperature: 0.9 }, FAILED] }), /not the planned null/);
});

test("turns_done must sit between 0 and the run's turns", () => {
  assert.match(problems({ cells: [{ ...PLAYED, turns_done: 3 }, FAILED] }), /from 0 to 2/);
  assert.match(problems({ cells: [{ ...PLAYED, turns_done: undefined }, FAILED] }), /turns_done/);
});

test("a conversation must open with the user", () => {
  assert.match(
    problems({ cells: [{ ...PLAYED, messages: PLAYED.messages.slice(1) }, FAILED] }),
    /open with the user/,
  );
});

test("a malformed message is refused", () => {
  const broken = [{ role: "user", content: "hi" }, { role: "assistant", content: 3 }];
  assert.match(problems({ cells: [{ ...PLAYED, messages: broken }, FAILED] }), /content must be a string/);
  const badCall = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "", tool_calls: [{ name: "x", arguments: {} }] },
  ];
  assert.match(problems({ cells: [{ ...PLAYED, messages: badCall }, FAILED] }), /tool_calls\[0\]/);
});

test("a score off the judge's scale is refused", () => {
  const grades = { principal: { score: 2, justification: "x" } };
  assert.match(problems({ cells: [{ ...PLAYED, grades }, FAILED] }), /2 is not on this judge's scale \(0, 1\)/);
});

test("the three outcomes of a grade are all accepted", () => {
  const grades = {
    principal: { score: null, justification: "Empty conversation." },
    awareness: { error: "The judge timed out." },
  };
  assert.ok("doc" in check({ cells: [{ ...PLAYED, grades }, FAILED] }));
});

test("a grade with both a score and an error is refused", () => {
  const grades = { principal: { score: 1, justification: "x", error: "y" } };
  assert.match(problems({ cells: [{ ...PLAYED, grades }, FAILED] }), /both a score and an error/);
});

test("a judge the run does not have is refused", () => {
  const grades = { tone: { score: 1, justification: "x" } };
  assert.match(problems({ cells: [{ ...PLAYED, grades }, FAILED] }), /no judge "tone"/);
});

test("a failed cell carries no grade", () => {
  const grades = { principal: { score: 0, justification: "x" } };
  assert.match(problems({ cells: [PLAYED, { ...FAILED, grades }] }), /leave its grades null/);
});

test("a negative cost is refused", () => {
  assert.match(problems({ cost_usd: -1, cells: [PLAYED, FAILED] }), /cost_usd/);
});

test("an untouched skeleton is refused rather than read as verdicts", () => {
  const skeleton = importSkeleton(EXPECT);
  assert.match(problems(skeleton), /neither messages nor an error/);
});

const JUDGE_EXTENSION: ImportExpectation = {
  cells: [],
  turns: 2,
  judges: [],
  conversations: [{ scenario_index: 0, target_model: "a/1", repetition: 0 }],
  newJudges: [{ key: "new_judges[0]", scale: [0, 1, 2] }],
};

test("a judge extension takes one grade per conversation", () => {
  const doc = {
    grades: [
      { scenario_index: 0, target_model: "a/1", repetition: 0, judge: "new_judges[0]", grade: { score: 2, justification: "x" } },
    ],
  };
  assert.ok("doc" in check(doc, JUDGE_EXTENSION));
});

test("a judge extension refuses a grade on a conversation that is not finished", () => {
  const doc = {
    grades: [
      { scenario_index: 0, target_model: "a/1", repetition: 5, judge: "new_judges[0]", grade: null },
    ],
  };
  assert.match(problems(doc, JUDGE_EXTENSION), /not a finished conversation/);
});

test("grades on a draft that adds no judge are refused", () => {
  const doc = {
    cells: [PLAYED, FAILED],
    grades: [{ scenario_index: 0, target_model: "a/1", repetition: 0, judge: "x", grade: null }],
  };
  assert.match(problems(doc), /adds no judge/);
});

test("the declared total wins over the cells' costs", () => {
  assert.equal(importCost({ cost_usd: 3, cells: [{ ...PLAYED, cost_usd: 1 } as never], grades: [] }), 3);
});

test("without a total, the cells' costs add up only when every played cell has one", () => {
  const a = { ...PLAYED, cost_usd: 0.25 } as never;
  const b = { ...PLAYED, repetition: 1, cost_usd: 0.5 } as never;
  assert.equal(importCost({ cells: [a, b, FAILED as never], grades: [] }), 0.75);
  assert.equal(importCost({ cells: [a, { ...PLAYED, repetition: 1 } as never], grades: [] }), null);
});

test("a failed cell's declared cost counts in the total when there is no declared total", () => {
  const played = { ...PLAYED, cost_usd: 0.25 } as never;
  const failed = { ...FAILED, cost_usd: 0.1 } as never;
  assert.equal(Math.round(importCost({ cells: [played, failed], grades: [] })! * 100) / 100, 0.35);
});

test("an import that plays nothing and declares nothing costs an unknown amount", () => {
  assert.equal(importCost({ cells: [], grades: [] }), null);
});

test("unknown plus anything stays unknown", () => {
  assert.equal(addCosts(null, 2), null);
  assert.equal(addCosts(2, null), null);
  assert.equal(addCosts(1.5, 2), 3.5);
});

test("an import writes played cells, failed cells and the grades provided", () => {
  const doc = {
    cells: [{ ...PLAYED, cost_usd: 0.1 }, FAILED] as never,
    grades: [],
  };
  const writes = importWrites(
    "run-1",
    doc,
    new Map([
      ["0|a/1|0", "s-0"],
      ["0|a/1|1", "s-1"],
    ]),
    new Map([
      ["principal", "rj-p"],
      ["awareness", "rj-w"],
    ]),
    "now()",
  );
  assert.deepEqual(writes.played, [
    {
      id: "s-0",
      run_id: "run-1",
      scenario_index: 0,
      target_model: "a/1",
      repetition: 0,
      cost_usd: 0.1,
      finished_at: "now()",
      status: "done",
      error: null,
      messages: PLAYED.messages,
      turns_done: 1,
      started_at: "now()",
    },
  ]);
  assert.deepEqual(writes.failed, [
    {
      id: "s-1",
      run_id: "run-1",
      scenario_index: 0,
      target_model: "a/1",
      repetition: 1,
      cost_usd: null,
      finished_at: "now()",
      status: "error",
      error: "The provider refused the request.",
    },
  ]);
  assert.deepEqual(writes.scores, [
    {
      run_judge_id: "rj-p",
      sample_id: "s-0",
      run_id: "run-1",
      status: "done",
      score: 1,
      justification: "at turn 1",
      error: null,
    },
  ]);
});

test("a judge's failure is written as an error, never as a grade", () => {
  const doc = {
    cells: [{ ...PLAYED, grades: { principal: { error: "Timed out." } } }] as never,
    grades: [],
  };
  const writes = importWrites("r", doc, new Map([["0|a/1|0", "s"]]), new Map([["principal", "p"]]), "now()");
  assert.deepEqual(writes.scores[0], {
    run_judge_id: "p",
    sample_id: "s",
    run_id: "r",
    status: "error",
    score: null,
    justification: "",
    error: "Timed out.",
  });
});

test("a new judge's grades are written on the conversations they name", () => {
  const doc = {
    cells: [],
    grades: [
      { scenario_index: 0, target_model: "a/1", repetition: 0, judge: "new_judges[0]", grade: { score: 0, justification: "no" } },
      { scenario_index: 0, target_model: "a/1", repetition: 1, judge: "new_judges[0]", grade: null },
    ],
  };
  const writes = importWrites(
    "r",
    doc,
    new Map([
      ["0|a/1|0", "s-0"],
      ["0|a/1|1", "s-1"],
    ]),
    new Map([["new_judges[0]", "rj-new"]]),
    "now()",
  );
  assert.deepEqual(writes.played, []);
  assert.equal(writes.scores.length, 1);
  assert.equal(writes.scores[0].sample_id, "s-0");
  assert.equal(writes.scores[0].run_judge_id, "rj-new");
});

test("a cell the run does not hold is a loud failure, not a silent skip", () => {
  assert.throws(
    () => importWrites("r", { cells: [PLAYED as never], grades: [] }, new Map(), new Map(), "now()"),
    /No cell scenario 0, a\/1, repetition 0 on run r/,
  );
});

test("the summary counts what was played and what is left pending", () => {
  const doc = { cells: [PLAYED, FAILED] as never, grades: [] };
  assert.equal(
    importSummary(doc, EXPECT),
    "1 conversation played, 1 failed, 1 grade given. 1 grade left pending: the run " +
      "page's catch-up button can have it graded here, at our cost.",
  );
});

test("the two doors stay apart", () => {
  assert.match(playedElsewhereProblem({ id: "r", origin: "external" }) ?? "", /played outside/);
  assert.equal(playedElsewhereProblem({ id: "r", origin: "cloud-run" }), null);
  assert.match(playedHereProblem({ id: "r", origin: "cloud-run" }) ?? "", /launch_draft/);
  assert.equal(playedHereProblem({ id: "r", origin: "external" }), null);
});
