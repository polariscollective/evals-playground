// The shape of a run identifier, shared by the public page and the
// outils MCP : deux copies de cette expression auraient fini par diverger.
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
