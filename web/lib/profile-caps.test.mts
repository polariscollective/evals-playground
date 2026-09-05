// La règle d'un plafond valide, sans Supabase ni session : voir profile-caps.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capProblem } from "./profile-caps.ts";

test("un nombre positif passe, entier ou non", () => {
  assert.equal(capProblem(2), null);
  assert.equal(capProblem(0.5), null);
  assert.equal(capProblem(0.0001), null);
});

test("zéro et le négatif sont refusés — ils rouvriraient le budget en grand", () => {
  assert.notEqual(capProblem(0), null);
  assert.notEqual(capProblem(-1), null);
});

test("ce qui n'est pas un nombre fini est refusé", () => {
  assert.notEqual(capProblem(NaN), null);
  assert.notEqual(capProblem(Infinity), null);
  assert.notEqual(capProblem(-Infinity), null);
});

test("ce qui n'est même pas du type number est refusé", () => {
  // Le corps d'une requête PATCH est un JSON quelconque avant d'être vérifié.
  assert.notEqual(capProblem("2"), null);
  assert.notEqual(capProblem(undefined), null);
  assert.notEqual(capProblem(null), null);
});
