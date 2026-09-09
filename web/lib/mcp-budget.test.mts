// The budget decision, without Supabase: see mcp-budget.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetProblem } from "./mcp-budget.ts";

test("un devis sous les deux plafonds passe", () => {
  assert.equal(budgetProblem(1, 3, 2, 10), null);
});

test("a quote over the per-run cap is refused, without looking at the hour", () => {
  const problem = budgetProblem(5, 0, 2, 10);
  assert.match(problem!, /\$5\.00/);
  assert.match(problem!, /\$2\.00/);
  // Les plafonds sont ceux du profil de l'appelant, plus une variable
  // environment variable shared by everyone — see profiles.ts.
  assert.doesNotMatch(problem!, /MCP_MAX_USD/);
});

test("a quote that would pass alone but would breach the hour is refused", () => {
  const problem = budgetProblem(2, 9, 5, 10);
  assert.match(problem!, /\$9\.00/, "what is already spent must be readable");
  assert.match(problem!, /\$11\.00/, "the projected figure must be readable");
  assert.match(problem!, /\$10\.00/, "the cap must be readable");
  assert.doesNotMatch(problem!, /MCP_MAX_USD/);
});

test("pile au plafond passe, un cent au-dessus refuse", () => {
  assert.equal(budgetProblem(2, 0, 2, 10), null);
  assert.notEqual(budgetProblem(2.01, 0, 2, 10), null);
  assert.equal(budgetProblem(1, 9, 2, 10), null);
  assert.notEqual(budgetProblem(1.01, 9, 2, 10), null);
});

test("un devis minuscule ne s'affiche pas 0,00 $", () => {
  const problem = budgetProblem(0.001, 0, 0.0001, 10);
  assert.match(problem!, /\$0\.0010/);
});
