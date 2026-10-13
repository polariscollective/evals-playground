// Named judge notes per scenario, and the note a judge chooses: pure rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  judgeNoteChoiceProblem,
  judgeNotesProblem,
  noteNamesOf,
} from "./judge-notes.ts";

const SCENARIOS: { judge_notes?: Record<string, string> }[] = [
  { judge_notes: { "persona-v2": "Passage 3 applies." } },
  { judge_notes: { "persona-v2": "Passage 4.", strict: "Read rule 2 literally." } },
  {},
];

test("well-formed notes pass", () => {
  assert.equal(judgeNotesProblem({ "persona-v2": "Passage 3." }, "scenario 0"), null);
  assert.equal(judgeNotesProblem(undefined, "scenario 0"), null);
});

test("a note name is lowercase letters, digits and hyphens", () => {
  assert.match(judgeNotesProblem({ "Persona V2": "x" }, "scenario 0") ?? "", /Persona V2/);
  assert.match(judgeNotesProblem({ persona_v2: "x" }, "scenario 0") ?? "", /persona_v2/);
});

test("an empty note text is refused", () => {
  assert.match(judgeNotesProblem({ v2: "  " }, "scenario 0") ?? "", /empty/);
});

test("the note names a run carries, each once, in order", () => {
  assert.deepEqual(noteNamesOf(SCENARIOS), ["persona-v2", "strict"]);
});

test("a judge may choose a note some scenario carries", () => {
  assert.equal(judgeNoteChoiceProblem("strict", SCENARIOS, "judge 1"), null);
  assert.equal(judgeNoteChoiceProblem(null, SCENARIOS, "judge 1"), null);
  assert.equal(judgeNoteChoiceProblem(undefined, SCENARIOS, "judge 1"), null);
});

test("a note no scenario carries is refused, so a typo cannot pass silently", () => {
  const problem = judgeNoteChoiceProblem("persona-v3", SCENARIOS, "judge 1") ?? "";
  assert.match(problem, /persona-v3/);
  assert.match(problem, /persona-v2, strict/);
});

test("a malformed choice is refused", () => {
  assert.match(judgeNoteChoiceProblem("Persona", SCENARIOS, "judge 1") ?? "", /Persona/);
});
