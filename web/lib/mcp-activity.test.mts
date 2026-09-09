// The sliding hour's sentence, with no Supabase: see mcp-activity.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activitySentence } from "./mcp-activity.ts";

test("zero launches is said calmly, not as an empty table", () => {
  assert.equal(
    activitySentence(0, 0),
    "No run or extension launched by an agent in the last hour.",
  );
});

test("le singulier et le pluriel restent distincts", () => {
  assert.match(
    activitySentence(1, 0.5),
    /^1 agent-triggered launch in the last hour/,
  );
  assert.match(
    activitySentence(3, 0.5),
    /^3 agent-triggered launches in the last hour/,
  );
});

test("an amount under a cent does not show as $0.00 — a tiny extension is still real", () => {
  const sentence = activitySentence(1, 0.0007);
  assert.match(sentence, /\$0\.0007/);
  assert.doesNotMatch(sentence, /\$0\.00\b/);
});

test("an amount above a cent keeps two decimals", () => {
  assert.match(activitySentence(2, 1.5), /\$1\.50/);
});
