// Planning a run copy: what the new run holds, before anything is written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planCopy, type CopySource } from "./run-copy.ts";
import type { EvalRunConfig, RubricLevel } from "./types";

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "No." },
  { value: 1, meaning: "Yes." },
];

function config(): EvalRunConfig {
  return {
    scenarios: ["A", "B", "C"].map((title) => ({
      title,
      system_prompt: "p",
      opening_message: "hi",
      ...(title === "C" ? { judge_notes: { "persona-v2": "Passage 3." } } : {}),
    })),
    criterion: "Did it hold?",
    rubric: RUBRIC,
    targets: [{ expected: 1 }, { expected: 0 }, { expected: 1, check: true }],
    turns: 1,
    repetitions: 2,
    models: { targets: ["a/1", "b/1"], judge: "j/1" },
    adversary_prompt: "",
    check_eval_awareness: true,
  };
}

function source(overrides: Partial<CopySource["run"]> = {}): CopySource {
  const samples = [];
  for (const scenario of [0, 1, 2]) {
    for (const model of ["a/1", "b/1"]) {
      for (const repetition of [0, 1]) {
        samples.push({
          id: `s-${scenario}-${model}-${repetition}`,
          scenario_index: scenario,
          scenario_title: ["A", "B", "C"][scenario],
          target_model: model,
          repetition,
          status: "done" as const,
          temperature: null,
          turns_done: 1,
          messages: [{ role: "user" as const, content: `hi ${scenario}` }],
          usage: {},
          cost_usd: 0.01,
          error: null,
          started_at: null,
          finished_at: null,
        });
      }
    }
  }
  const described = (criterion: string) => ({
    criterion,
    rubric: RUBRIC,
    label: criterion,
    grades: "assistant" as const,
    sees_adversary_goals: false,
    sees_system_prompt: true,
    higher_is_better: true,
  });
  const links = [
    { id: "rj-p", judge_id: "j-p", system_type: "ordinary" as const, is_principal: true, model: "j/1", targets: [{ expected: 1 }, { expected: 0 }, { expected: 1, check: true }], judge_note: null, judge: described("Did it hold?") },
    { id: "rj-x", judge_id: "j-x", system_type: "ordinary" as const, is_principal: false, model: "j/2", targets: null, judge_note: "persona-v2", judge: described("Did it cite?") },
    { id: "rj-w", judge_id: "j-w", system_type: "awake" as const, is_principal: false, model: "j/1", targets: null, judge_note: null, judge: { criterion: null, rubric: null, label: "Eval awareness", grades: "assistant" as const, sees_adversary_goals: false, sees_system_prompt: true, higher_is_better: false } },
  ];
  const scores = samples.flatMap((sample) =>
    links.map((link) => ({
      run_judge_id: link.id,
      sample_id: sample.id,
      status: "done" as const,
      score: 1,
      justification: `${link.id} on ${sample.id}`,
      error: null,
    })),
  );
  return {
    run: {
      id: "src",
      label: "Common base",
      notes: "Why this run.",
      status: "done",
      origin: "cloud-run",
      config: config(),
      ...overrides,
    },
    samples,
    links,
    scores,
    toolResults: [
      { scenario_index: 2, tool_name: "lookup", arguments_hash: "h1", result: "r" },
      { scenario_index: 0, tool_name: "lookup", arguments_hash: "h2", result: "r" },
    ],
  };
}

let next = 0;
const newId = () => `new-${next++}`;

test("a whole copy holds every cell, grade and cost of its source", () => {
  const plan = planCopy(source(), {}, newId);
  assert.ok(!("problem" in plan));
  assert.equal(plan.samples.length, 12);
  assert.equal(plan.links.length, 3);
  assert.equal(plan.scores.length, 36);
  assert.equal(plan.moneySaved, 0.12);
  assert.deepEqual(plan.scope.scenarios, [0, 1, 2]);
});

test("a reduced copy keeps only the chosen scenarios, models, judges and repetitions", () => {
  const plan = planCopy(
    source(),
    { scenario_indices: [2, 0], target_models: ["b/1"], run_judge_ids: ["rj-p", "rj-x"], repetitions: [1] },
    newId,
  );
  assert.ok(!("problem" in plan));
  // Scenarios keep the source's order; the scope says where each came from.
  assert.deepEqual(plan.scope.scenarios, [0, 2]);
  assert.deepEqual(plan.config.scenarios.map((s) => s.title), ["A", "C"]);
  assert.deepEqual(plan.config.models.targets, ["b/1"]);
  assert.equal(plan.config.repetitions, 1);
  // 2 scenarios x 1 model x 1 repetition.
  assert.equal(plan.samples.length, 2);
  assert.deepEqual(
    plan.samples.map((s) => [s.scenario_index, s.target_model, s.repetition]),
    [[0, "b/1", 0], [1, "b/1", 0]],
  );
  // The conversations are the source's, verbatim.
  assert.deepEqual(plan.samples[1].messages, [{ role: "user", content: "hi 2" }]);
  // Two judges kept, the awareness check dropped and switched off.
  assert.equal(plan.links.length, 2);
  assert.equal(plan.config.check_eval_awareness, false);
  assert.equal(plan.scores.length, 4);
  assert.equal(plan.moneySaved, 0.02);
});

test("grades and notes travel with the copy", () => {
  const plan = planCopy(source(), { scenario_indices: [2], target_models: ["a/1"] }, newId);
  assert.ok(!("problem" in plan));
  const noted = plan.links.find((link) => link.judge_note === "persona-v2");
  assert.ok(noted);
  assert.deepEqual(plan.config.scenarios[0].judge_notes, { "persona-v2": "Passage 3." });
  const score = plan.scores.find((row) => row.run_judge_id === noted.id);
  assert.match(score?.justification ?? "", /^rj-x on s-2-a\/1-/);
  assert.equal(score?.status, "done");
});

test("the copy's configuration describes exactly the judges it kept", () => {
  const plan = planCopy(source(), { run_judge_ids: ["rj-p"] }, newId);
  assert.ok(!("problem" in plan));
  assert.equal(plan.config.criterion, "Did it hold?");
  assert.deepEqual(plan.config.judges, []);
  assert.equal(plan.config.check_eval_awareness, false);
  const all = planCopy(source(), {}, newId);
  assert.ok(!("problem" in all));
  assert.deepEqual(
    all.config.judges?.map((judge) => [judge.criterion, judge.model, judge.judge_note]),
    [["Did it cite?", "j/2", "persona-v2"]],
  );
  assert.equal(all.config.check_eval_awareness, true);
});

test("targets follow the scenarios kept", () => {
  const plan = planCopy(source(), { scenario_indices: [1, 2] }, newId);
  assert.ok(!("problem" in plan));
  assert.deepEqual(plan.config.targets, [{ expected: 0 }, { expected: 1, check: true }]);
  assert.deepEqual(
    plan.links.find((link) => link.is_principal)?.targets,
    [{ expected: 0 }, { expected: 1, check: true }],
  );
});

test("served tool results follow their scenario, renumbered", () => {
  const plan = planCopy(source(), { scenario_indices: [2] }, newId);
  assert.ok(!("problem" in plan));
  assert.deepEqual(plan.toolResults, [
    { scenario_index: 0, tool_name: "lookup", arguments_hash: "h1", result: "r" },
  ]);
});

test("one copied cell without a known cost makes the saving unknown", () => {
  const src = source();
  src.samples[0].cost_usd = null;
  const plan = planCopy(src, {}, newId);
  assert.ok(!("problem" in plan));
  assert.equal(plan.moneySaved, null);
});

test("a failed cell without a cost costs nothing, as everywhere else", () => {
  const src = source();
  src.samples[0] = { ...src.samples[0], status: "error", cost_usd: null };
  const plan = planCopy(src, {}, newId);
  assert.ok(!("problem" in plan));
  assert.equal(plan.moneySaved, 0.11);
});

test("the principal judge is always copied", () => {
  const plan = planCopy(source(), { run_judge_ids: ["rj-x"] }, newId);
  assert.ok("problem" in plan);
  assert.match(plan.problem, /principal/);
});

test("a run still being played is not copied", () => {
  const plan = planCopy(source({ status: "running" }), {}, newId);
  assert.ok("problem" in plan);
  assert.match(plan.problem, /still going/);
});

test("a scope naming what the run does not hold is refused", () => {
  for (const scope of [
    { scenario_indices: [3] },
    { target_models: ["c/1"] },
    { run_judge_ids: ["rj-p", "rj-zz"] },
    { repetitions: [5] },
    { scenario_indices: [] },
  ]) {
    const plan = planCopy(source(), scope, newId);
    assert.ok("problem" in plan, JSON.stringify(scope));
  }
});
