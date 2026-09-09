// The same cases as `tests/test_eval_task.py` on the Python side: the two
// implementations must return exactly the same list, without which a cell added
// to a run would not have the temperature it is believed to be given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { temperaturesFor } from "./temperature.ts";

test("with no instruction, no temperature is sent", () => {
  assert.deepEqual(temperaturesFor(null, 3), [null, null, null]);
});

test("with no upper bound, every repetition takes the lower bound", () => {
  assert.deepEqual(temperaturesFor({ min: 0.8 }, 3), [0.8, 0.8, 0.8]);
});

test("with two bounds, the repetitions spread linearly", () => {
  assert.deepEqual(
    temperaturesFor({ min: 0, max: 1 }, 5),
    [0, 0.25, 0.5, 0.75, 1],
  );
});

test("a single repetition takes the lower bound", () => {
  assert.deepEqual(temperaturesFor({ min: 0.3, max: 0.9 }, 1), [0.3]);
});

test("les deux bornes sont comprises", () => {
  assert.deepEqual(temperaturesFor({ min: 0.2, max: 0.9 }, 2), [0.2, 0.9]);
});

test("the intermediate values drag no float noise", () => {
  // 0.1 + 0.2 is 0.30000000000000004: readable nowhere, and yet written
  // en base puis dans les exports.
  assert.deepEqual(temperaturesFor({ min: 0.1, max: 0.5 }, 3), [0.1, 0.3, 0.5]);
});

test("the upper bound is returned as it stands, with no float drift", () => {
  // 0.2 + 0.7 vaut 0.8999999999999999 par accumulation.
  const [, dernier] = temperaturesFor({ min: 0.2, max: 0.9 }, 2);
  assert.equal(dernier, 0.9);
});
