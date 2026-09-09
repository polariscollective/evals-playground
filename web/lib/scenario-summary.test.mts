// Ce que les pastilles doivent garder distinct.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scenarioBadges } from "./scenario-summary.ts";
import type { EvalScenario } from "./types";

const NU: EvalScenario = {
  title: "T",
  system_prompt: "S",
  opening_message: "O",
};

test("an ordinary scenario carries no pill", () => {
  assert.deepEqual(scenarioBadges(NU), []);
  // The empty forms are the same case, and must stay so: otherwise a whole
  // imported batch would carry three pills per row, saying nothing.
  assert.deepEqual(scenarioBadges({ ...NU, note: "", history: [] }), []);
  assert.deepEqual(scenarioBadges({ ...NU, note: "   " }), []);
});

test("the three tool states stay distinct on screen", () => {
  // That is the pills' reason to exist: `absent` and `none` produce the same
  // empty list on the model side, and are two different experiments.
  assert.deepEqual(scenarioBadges({ ...NU, tools: null }), []);
  assert.deepEqual(scenarioBadges({ ...NU, tools: [] }), ["no tools"]);
  assert.deepEqual(scenarioBadges({ ...NU, tools: ["a"] }), ["1 tool"]);
  assert.deepEqual(scenarioBadges({ ...NU, tools: ["a", "b"] }), ["2 tools"]);
});

test("a seeded history is counted, singular as well as plural", () => {
  const turn = { role: "user" as const, content: "x" };
  assert.deepEqual(scenarioBadges({ ...NU, history: [turn] }), [
    "1 seeded turn",
  ]);
  assert.deepEqual(scenarioBadges({ ...NU, history: [turn, turn] }), [
    "2 seeded turns",
  ]);
});

test("the pills come in the order they are read", () => {
  assert.deepEqual(
    scenarioBadges({
      ...NU,
      note: "pourquoi",
      history: [{ role: "user", content: "x" }],
      tools: [],
    }),
    ["note", "1 seeded turn", "no tools"],
  );
});
