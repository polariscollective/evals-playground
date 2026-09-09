// The building of the matrix, which lived on the Python side until the job
// stopped rebuilding it from the configuration. The shape and temperature cases
// come from `tests/test_eval_task.py`, the extension ones are new.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellsForExtension, cellsForRun, coupleKey } from "./cells.ts";
import type { EvalRunConfig, EvalScenario } from "./types.ts";

function scenario(suffix: string): EvalScenario {
  return {
    title: `Scenario ${suffix}`,
    system_prompt: `You assist the quality team (${suffix}).`,
    opening_message: `Opening of scenario ${suffix}.`,
  };
}

function config(overrides: Partial<EvalRunConfig> = {}): EvalRunConfig {
  return {
    scenarios: [scenario("A")],
    criterion: "The model provided the plan asked for.",
    rubric: [
      { value: 0, meaning: "Non." },
      { value: 1, meaning: "Oui." },
    ],
    turns: 1,
    repetitions: 4,
    models: { targets: ["mockllm/model"], judge: "mockllm/model" },
    adversary_prompt: "",
    ...overrides,
  };
}

// --- a fresh run -------------------------------------------------------------

test("one cell per scenario × model × repetition triple", () => {
  const cells = cellsForRun(
    config({
      repetitions: 4,
      scenarios: [scenario("A"), scenario("B")],
      models: { targets: ["a/1", "b/2", "c/3"], judge: "m" },
    }),
  );
  assert.equal(cells.length, 24);
});

test("every cell carries its scenario and its model", () => {
  const cells = cellsForRun(
    config({
      repetitions: 1,
      scenarios: [scenario("A"), scenario("B")],
      models: { targets: ["a/1", "b/2"], judge: "m" },
    }),
  );
  const couples = cells
    .map((cell) => `${cell.scenario_index} ${cell.target_model}`)
    .sort();
  assert.deepEqual(couples, ["0 a/1", "0 b/2", "1 a/1", "1 b/2"]);
});

test("the temperatures start over for each pair", () => {
  // Otherwise the following scenarios would inherit shifted temperatures, and
  // the comparison would rest on different settings from one row to the next.
  const cells = cellsForRun(
    config({
      repetitions: 3,
      temperature: { min: 0, max: 1 },
      scenarios: [scenario("A"), scenario("B")],
      models: { targets: ["a/1", "b/2"], judge: "m" },
    }),
  );
  const parCouple = new Map<string, (number | null)[]>();
  for (const cell of cells) {
    const key = coupleKey(cell.scenario_index, cell.target_model);
    parCouple.set(key, [...(parCouple.get(key) ?? []), cell.temperature]);
  }
  assert.equal(parCouple.size, 4);
  for (const temperatures of parCouple.values()) {
    assert.deepEqual(temperatures, [0, 0.5, 1]);
  }
});

// --- a run being completed ----------------------------------------------------

test("the added repetitions continue the pair's numbering", () => {
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["a/1"],
    3,
    null,
    new Map([["0 a/1", 3]]),
  );
  assert.deepEqual(
    cells.map((cell) => cell.repetition),
    [4, 5, 6],
  );
});

test("a pair never covered yet starts at zero", () => {
  // A new model on an old scenario: nothing to continue.
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["new/1"],
    2,
    null,
    new Map([["0 old/1", 7]]),
  );
  assert.deepEqual(
    cells.map((cell) => cell.repetition),
    [0, 1],
  );
});

test("each pair picks up where it is, independently of the others", () => {
  // A run completed twice does not advance at the same pace everywhere: a model
  // added along the way has fewer repetitions than the first ones.
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["a/1", "b/2"],
    1,
    null,
    new Map([
      ["0 a/1", 5],
      ["0 b/2", 1],
    ]),
  );
  assert.deepEqual(
    cells.map((cell) => `${cell.target_model}:${cell.repetition}`),
    ["a/1:6", "b/2:2"],
  );
});

test("the spread applies to the added repetitions, not to the total", () => {
  // Three more on a run that already had three: the new ones spread between the
  // bounds asked for now. The old ones keep theirs, which is written on their row
  // and which this code does not touch.
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["a/1"],
    3,
    { min: 0, max: 1 },
    new Map([["0 a/1", 2]]),
  );
  assert.deepEqual(
    cells.map((cell) => cell.temperature),
    [0, 0.5, 1],
  );
});

test("a new scenario takes the index after the run's", () => {
  const scenarios = [scenario("A"), scenario("B"), scenario("New")];
  const cells = cellsForExtension(scenarios, [2], ["a/1"], 1, null, new Map());
  assert.equal(cells.length, 1);
  assert.equal(cells[0].scenario_index, 2);
  assert.equal(cells[0].scenario_title, "Scenario New");
});

test("an index naming no scenario is ignored", () => {
  // A forged request must not write a cell the job will not know what to do
  // with: it reads the opening message by that very index.
  const cells = cellsForExtension([scenario("A")], [0, 9], ["a/1"], 1, null, new Map());
  assert.equal(cells.length, 1);
});
