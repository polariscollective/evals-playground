// La forme d'un identifiant de run, partagée par la page publique et les
// outils MCP : deux copies de cette expression auraient fini par diverger.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRunId } from "./run-id.ts";

test("un UUID v4 passe", () => {
  assert.equal(isRunId("2f1c9e6a-0000-4000-8000-000000000000"), true);
});

test("ce qui n'a pas cette forme est refusé", () => {
  for (const value of ["", "not-a-uuid", "2f1c9e6a-0000-4000-8000-00000000000"]) {
    assert.equal(isRunId(value), false, value);
  }
});
