import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionAddsNothing } from "./extension-plan.ts";

test("an extension that only adds a judge adds something", () => {
  // The "Own" judge with its self-v1 notes: no scenario, no repetition, one
  // judge to reread every conversation already played.
  assert.equal(extensionAddsNothing({ cases: [], continued: 0, newJudges: [{}] }), false);
});

test("cells or deepened attempts add something", () => {
  assert.equal(extensionAddsNothing({ cases: [{}], continued: 0, newJudges: [] }), false);
  assert.equal(extensionAddsNothing({ cases: [], continued: 2, newJudges: [] }), false);
});

test("nothing at all adds nothing", () => {
  assert.equal(extensionAddsNothing({ cases: [], continued: 0, newJudges: [] }), true);
});
