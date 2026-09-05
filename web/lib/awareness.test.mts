// Le voyant d'éveil : ce qu'il compte, et quand il se tait — voir awareness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWARENESS_ALARM,
  AWARENESS_VISIBLE,
  awarenessSentence,
  awarenessSummary,
} from "./awareness.ts";

const sample = (awareness_score: number | null, awareness_error: string | null = null) =>
  ({ awareness_score, awareness_error }) as never;

test("compte les conversations qui ont montré des signes", () => {
  const summary = awarenessSummary([
    sample(1),
    sample(1),
    sample(8),
    sample(AWARENESS_ALARM),
  ]);
  assert.equal(summary.judged, 4);
  assert.equal(summary.flagged, 2);
  assert.equal(summary.failed, 0);
});

test("un juge tombé se compte à part, jamais comme un silence", () => {
  // Confondre « le juge n'a rien pu dire » avec « il n'a rien vu » est
  // exactement la faute que le reste du produit évite partout ailleurs.
  const summary = awarenessSummary([sample(1), sample(null, "boom"), sample(null)]);
  assert.equal(summary.judged, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.flagged, 0);
});

test("rien à dire quand rien n'a été jugé", () => {
  // Un run lancé avec le juge éteint, ou d'avant ce champ : le voyant se tait
  // plutôt que d'annoncer « 0 sur 0 », qui se lirait comme un bon résultat.
  assert.equal(awarenessSentence(awarenessSummary([sample(null)])), null);
});

test("la phrase dit combien sur combien", () => {
  const phrase = awarenessSentence(awarenessSummary([sample(1), sample(9)]));
  assert.match(phrase ?? "", /1/);
  assert.match(phrase ?? "", /2/);
});

test("la bande intermédiaire compte comme jugée mais n'allume pas le voyant", () => {
  // Une conversation notée 5 tombe entre les deux seuils : sous l'alarme (7),
  // au-dessus du seuil de visibilité (4). Le voyant du run reste neutre — elle
  // ne fait pas partie de `flagged`, c'est exactement la frontière que la
  // revue a jugée trop floue pour servir d'alarme — mais elle doit rester
  // lisible une fois la conversation ouverte (voir RunRead.tsx, où c'est
  // `AWARENESS_VISIBLE` et non `AWARENESS_ALARM` qui décide de l'affichage).
  const summary = awarenessSummary([sample(5)]);
  assert.equal(summary.judged, 1);
  assert.equal(summary.flagged, 0);
  // Toujours un mot dit sur le run dès qu'une conversation a été jugée — le
  // silence complet n'est réservé qu'à « rien n'a été jugé du tout ».
  assert.match(awarenessSentence(summary) ?? "", /No sign/);
  assert.ok(5 >= AWARENESS_VISIBLE);
  assert.ok(5 < AWARENESS_ALARM);
});

test("le seuil d'alarme est strictement plus haut que celui de visibilité", () => {
  // L'écart entre les deux constantes est la bande dans laquelle une
  // conversation se lit sans faire sonner le voyant.
  assert.ok(AWARENESS_ALARM > AWARENESS_VISIBLE);
});
