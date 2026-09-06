// Le prédicat du rattrapage, isolé : voir le commentaire de tête de
// `catchup.ts` pour le bug qu'il existe pour empêcher de reproduire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catchupCandidateCount } from "./catchup.ts";

test("une ligne en attente sur une conversation terminée compte", () => {
  const count = catchupCandidateCount([{ sample_id: "s1" }], new Set(["s1"]));
  assert.equal(count, 1);
});

test("une ligne en attente sur une conversation pas encore terminée ne compte pas", () => {
  // Reproduit le bug d'origine du chantier : une conversation annulée ou
  // encore en cours porte quand même sa ligne de score en attente — posée
  // d'avance, au lancement — mais le moteur ne la touchera jamais tant
  // qu'elle n'est pas `done` (voir `catchup_dataset`,
  // backend/playground/batch_job.py). Un compte qui l'ignorerait
  // annoncerait « 1 à rattraper » pour un rattrapage qui en ferait 0.
  const count = catchupCandidateCount(
    [{ sample_id: "annulée-1" }],
    new Set(), // aucune conversation terminée
  );
  assert.equal(count, 0);
});

test("compte juste sur un mélange de lignes terminées et non", () => {
  const count = catchupCandidateCount(
    [{ sample_id: "a" }, { sample_id: "b" }, { sample_id: "c" }],
    new Set(["a", "c"]),
  );
  assert.equal(count, 2);
});

test("aucune ligne en attente : rien à rattraper", () => {
  assert.equal(catchupCandidateCount([], new Set(["a"])), 0);
});
