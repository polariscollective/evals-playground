import { test } from "node:test";
import assert from "node:assert/strict";
import { served, servesTools } from "./tools.ts";

test("un outil sans règles de lecture est fixe", () => {
  assert.equal(served({ retrieval_rules: undefined }), false);
  assert.equal(served({ retrieval_rules: "" }), false);
  // Des blancs ne sont pas des règles : un champ effacé à moitié dans un
  // formulaire ne doit pas faire basculer l'outil en servi, et donc payer.
  assert.equal(served({ retrieval_rules: "   \n  " }), false);
});

test("un outil avec des règles de lecture est servi", () => {
  assert.equal(served({ retrieval_rules: "Return at most twenty lines." }), true);
});

test("un run sert dès qu'un seul de ses outils sert", () => {
  assert.equal(servesTools([]), false);
  assert.equal(servesTools([{ retrieval_rules: "" }]), false);
  assert.equal(
    servesTools([{ retrieval_rules: "" }, { retrieval_rules: "rules" }]),
    true,
  );
});
