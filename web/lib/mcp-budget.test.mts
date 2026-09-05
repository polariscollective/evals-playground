// La décision de budget, sans Supabase : voir mcp-budget.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { budgetProblem } from "./mcp-budget.ts";

test("un devis sous les deux plafonds passe", () => {
  assert.equal(budgetProblem(1, 3, 2, 10), null);
});

test("un devis qui dépasse le plafond par run est refusé, sans regarder l'heure", () => {
  const problem = budgetProblem(5, 0, 2, 10);
  assert.match(problem!, /\$5\.00/);
  assert.match(problem!, /\$2\.00/);
  // Les plafonds sont ceux du profil de l'appelant, plus une variable
  // d'environnement partagée par tout le monde — voir profiles.ts.
  assert.doesNotMatch(problem!, /MCP_MAX_USD/);
});

test("un devis qui passerait seul mais ferait dépasser l'heure est refusé", () => {
  const problem = budgetProblem(2, 9, 5, 10);
  assert.match(problem!, /\$9\.00/, "le déjà-dépensé doit être lisible");
  assert.match(problem!, /\$11\.00/, "le projeté doit être lisible");
  assert.match(problem!, /\$10\.00/, "le plafond doit être lisible");
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
