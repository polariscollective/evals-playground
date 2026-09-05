// Ce que la comparaison de `replaces` doit permettre et refuser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisReplaceAllowed } from "./analysis.ts";

test("une analyse vide s'écrit sans condition", () => {
  assert.equal(analysisReplaceAllowed("", "n'importe quoi"), true);
  assert.equal(analysisReplaceAllowed("", undefined), true);
  // Que des blancs revient à vide : rien de lisible n'y est écrit.
  assert.equal(analysisReplaceAllowed("   \n", undefined), true);
});

test("une analyse non vide exige un replaces qui la désigne", () => {
  assert.equal(analysisReplaceAllowed("Le modèle refuse tout.", undefined), false);
  assert.equal(analysisReplaceAllowed("Le modèle refuse tout.", "autre chose"), false);
  assert.equal(
    analysisReplaceAllowed("Le modèle refuse tout.", "Le modèle refuse tout."),
    true,
  );
});

test("les blancs de début et de fin ne comptent pas dans la comparaison", () => {
  assert.equal(
    analysisReplaceAllowed("Le modèle refuse tout.\n", "Le modèle refuse tout."),
    true,
  );
  assert.equal(
    analysisReplaceAllowed("Le modèle refuse tout.", "  Le modèle refuse tout.\n\n"),
    true,
  );
});
