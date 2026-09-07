// La moyenne tirée de l'histogramme rendu par la vue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meanFromHistogram } from "./run-list-mean.ts";

test("aucun histogramme : aucune moyenne", () => {
  // Distinct d'un histogramme vide : personne n'a encore noté.
  assert.equal(meanFromHistogram(null, []), null);
});

test("la moyenne pondère par le nombre de fois qu'une note est tombée", () => {
  // 0 trois fois, 2 cinq fois → (0×3 + 2×5) / 8
  assert.equal(meanFromHistogram({ "0": 3, "2": 5 }, []), 10 / 8);
});

test("les clés flottantes de Postgres se lisent", () => {
  // `jsonb_object_agg` sur un `double precision` rend « 0.0 », pas « 0 ».
  assert.equal(meanFromHistogram({ "0.0": 2, "1.0": 2 }, []), 0.5);
});

test("un palier exclu sort de la moyenne, il ne compte pas comme zéro", () => {
  // C'est toute la raison pour laquelle le calcul n'est pas en SQL.
  const rubric = [
    { value: 0, meaning: "non" },
    { value: 2, meaning: "oui" },
    { value: 9, meaning: "sans objet", excluded: true },
  ];
  assert.equal(meanFromHistogram({ "0": 1, "2": 1, "9": 10 }, rubric), 1);
});

test("tout exclu : aucune moyenne, et non zéro", () => {
  const rubric = [{ value: 9, meaning: "sans objet", excluded: true }];
  assert.equal(meanFromHistogram({ "9": 4 }, rubric), null);
});

test("une clé illisible est ignorée plutôt que de produire NaN", () => {
  assert.equal(meanFromHistogram({ "2": 1, "n'importe quoi": 5 }, []), 2);
});
