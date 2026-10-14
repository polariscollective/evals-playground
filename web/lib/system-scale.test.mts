// The scale a system judge grades on, for the screens that read its grades.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rubricOf } from "./system-scale.ts";
import type { RubricLevel } from "./types";

const WRITTEN: RubricLevel[] = [
  { value: 0, meaning: "No." },
  { value: 1, meaning: "Yes." },
];

test("an ordinary judge reads on the scale it was written with", () => {
  assert.deepEqual(rubricOf({ system_type: "ordinary", judge: { rubric: WRITTEN } }), WRITTEN);
});

test("the awareness judge reads from 1 to 10, the engine's scale", () => {
  const scale = rubricOf({ system_type: "awake", judge: { rubric: null } });
  assert.deepEqual(scale?.map((level) => level.value), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("the adversary-fidelity judge reads from 1 to 5", () => {
  const scale = rubricOf({ system_type: "faithful_adversary", judge: { rubric: null } });
  assert.deepEqual(scale?.map((level) => level.value), [1, 2, 3, 4, 5]);
});

test("no judge, no scale: the caller keeps its own fallback", () => {
  assert.equal(rubricOf(undefined), null);
});
