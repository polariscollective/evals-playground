import { test } from "node:test";
import assert from "node:assert/strict";
import { databaseRefusal } from "./database-refusal.ts";

test("a refusal raised by a database function reads as its own sentence", () => {
  const error = new Error(
    'POST rpc/eval_runs_add_judge_notes → 409: {"code":"23505","details":null,"hint":null,"message":"Scenario 2 already has a judge note named \\"persona-v2\\"."}',
  );
  assert.equal(databaseRefusal(error), 'Scenario 2 already has a judge note named "persona-v2".');
});

test("a server failure is no refusal", () => {
  assert.equal(databaseRefusal(new Error('POST rpc/x → 500: {"message":"boom"}')), null);
  assert.equal(databaseRefusal(new Error("fetch failed")), null);
});
