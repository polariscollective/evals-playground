// What the `replaces` comparison must allow and refuse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisReplaceAllowed } from "./analysis.ts";

test("an empty analysis is written unconditionally", () => {
  assert.equal(analysisReplaceAllowed("", "anything at all"), true);
  assert.equal(analysisReplaceAllowed("", undefined), true);
  // Whitespace only amounts to empty: nothing readable is written in it.
  assert.equal(analysisReplaceAllowed("   \n", undefined), true);
});

test("a non-empty analysis requires a replaces that names it", () => {
  assert.equal(analysisReplaceAllowed("The model refuses everything.", undefined), false);
  assert.equal(analysisReplaceAllowed("The model refuses everything.", "something else"), false);
  assert.equal(
    analysisReplaceAllowed("The model refuses everything.", "The model refuses everything."),
    true,
  );
});

test("leading and trailing whitespace does not count in the comparison", () => {
  assert.equal(
    analysisReplaceAllowed("The model refuses everything.\n", "The model refuses everything."),
    true,
  );
  assert.equal(
    analysisReplaceAllowed("The model refuses everything.", "  The model refuses everything.\n\n"),
    true,
  );
});
