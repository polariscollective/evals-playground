import { test } from "node:test";
import assert from "node:assert/strict";
import { TOUCH_INTERVAL_MS, clientLabelOf, needsTouch } from "./mcp-grants.ts";

const NOW = new Date("2026-09-04T12:00:00Z");

test("a grant that has never served gets marked", () => {
  assert.equal(needsTouch(null, NOW), true);
});

test("a brand-new use is not rewritten", () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  assert.equal(needsTouch(recent, NOW), false);
});

test("past the interval, we rewrite", () => {
  const old = new Date(NOW.getTime() - TOUCH_INTERVAL_MS - 1).toISOString();
  assert.equal(needsTouch(old, NOW), true);
});

test("an unreadable date counts as an absent date", () => {
  // A column frozen on a value nobody can read back would never catch up.
  assert.equal(needsTouch("not a date", NOW), true);
});

test("an empty or missing user agent does not become an empty string", () => {
  assert.equal(clientLabelOf(null), null);
  assert.equal(clientLabelOf(undefined), null);
  assert.equal(clientLabelOf("   "), null);
});

test("a user agent is kept as it stands, stripped of its edges", () => {
  assert.equal(clientLabelOf("  claude-ai/1.0  "), "claude-ai/1.0");
});

test("a tirade is truncated rather than stored whole", () => {
  const label = clientLabelOf("x".repeat(500));
  assert.equal(label?.length, 200);
});
