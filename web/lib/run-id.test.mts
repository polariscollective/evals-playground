// The shape of a run identifier, shared by the public page and the MCP tools:
// two copies of this expression would have ended up diverging.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunId } from "./run-id.ts";

test("un UUID v4 passe", () => {
  assert.equal(isRunId("2f1c9e6a-0000-4000-8000-000000000000"), true);
});

test("anything not of that shape is refused", () => {
  for (const value of ["", "not-a-uuid", "2f1c9e6a-0000-4000-8000-00000000000"]) {
    assert.equal(isRunId(value), false, value);
  }
});
