// Les mêmes cas que `tests/test_eval_task.py` côté Python : les deux
// implémentations doivent rendre exactement la même liste, sans quoi une case
// ajoutée à un run n'aurait pas la température qu'on croit lui donner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { temperaturesFor } from "./temperature.ts";

test("sans consigne, aucune température n'est envoyée", () => {
  assert.deepEqual(temperaturesFor(null, 3), [null, null, null]);
});

test("sans borne haute, toutes les répétitions prennent la borne basse", () => {
  assert.deepEqual(temperaturesFor({ min: 0.8 }, 3), [0.8, 0.8, 0.8]);
});

test("avec deux bornes, les répétitions s'étalent linéairement", () => {
  assert.deepEqual(
    temperaturesFor({ min: 0, max: 1 }, 5),
    [0, 0.25, 0.5, 0.75, 1],
  );
});

test("une répétition unique prend la borne basse", () => {
  assert.deepEqual(temperaturesFor({ min: 0.3, max: 0.9 }, 1), [0.3]);
});

test("les deux bornes sont comprises", () => {
  assert.deepEqual(temperaturesFor({ min: 0.2, max: 0.9 }, 2), [0.2, 0.9]);
});

test("les valeurs intermédiaires ne trainent pas de bruit flottant", () => {
  // 0.1 + 0.2 vaut 0.30000000000000004 : lisible nulle part, et pourtant écrit
  // en base puis dans les exports.
  assert.deepEqual(temperaturesFor({ min: 0.1, max: 0.5 }, 3), [0.1, 0.3, 0.5]);
});

test("la borne haute est rendue telle quelle, sans dérive flottante", () => {
  // 0.2 + 0.7 vaut 0.8999999999999999 par accumulation.
  const [, dernier] = temperaturesFor({ min: 0.2, max: 0.9 }, 2);
  assert.equal(dernier, 0.9);
});
