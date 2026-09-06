// Le voyant d'éveil : ce qu'il compte, et quand il se tait — voir awareness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWARENESS_ALARM,
  AWARENESS_VISIBLE,
  awarenessMissing,
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

test("le juge tombé sur tout dit l'échec, pas le silence", () => {
  // Judged à zéro peut vouloir dire deux choses opposées : rien à mesurer, ou
  // le juge qui s'est cassé les dents sur chaque conversation. Les confondre
  // dirait « tout va bien » alors qu'on ne sait rien — exactement la faute que
  // `failed` existe pour éviter (voir le test juste au-dessus, à l'échelle
  // d'une seule case).
  const summary = awarenessSummary([sample(null, "boom"), sample(null, "boom")]);
  assert.equal(summary.judged, 0);
  assert.equal(summary.failed, 2);
  const phrase = awarenessSentence(summary);
  assert.match(phrase ?? "", /failed/);
  assert.match(phrase ?? "", /2/);
  assert.doesNotMatch(phrase ?? "", /No sign/);
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

// Un tour d'assistant qui a vraiment répondu quelque chose — le format minimal
// dont `hasGradableContent`, dans awareness.ts, a besoin pour trancher.
const attempt = (awareness_score: number | null, assistantContents: string[]) => ({
  awareness_score,
  messages: assistantContents.map((content) => ({
    role: "assistant" as const,
    content,
  })),
});

test("compte les conversations à qui il manque une note d'éveil", () => {
  // C'est ce nombre qui décide si le bouton a une raison d'exister, et ce
  // qu'il annonce coûter. Une conversation vide n'en fait pas partie : elle
  // n'a rien à lire, et la passe ne l'appellera pas.
  assert.equal(
    awarenessMissing([
      attempt(null, ["hello"]),
      attempt(1, ["hi"]),
      attempt(null, ["hey"]),
    ]),
    2,
  );
  // Déjà toutes notées : rien à proposer.
  assert.equal(awarenessMissing([attempt(3, ["hi"]), attempt(1, ["hi"])]), 0);
  // Le modèle évalué n'a jamais été appelé : rien à juger.
  assert.equal(awarenessMissing([attempt(null, [])]), 0);
});

test("une conversation bloquée par le fournisseur ne compte pas comme manquante", () => {
  // C'est le défaut B1 : l'ancienne règle ne regardait que la présence de
  // tours, pas leur contenu. Un tour d'assistant vide — filtre de contenu du
  // fournisseur, réponse vide — a un transcript non vide mais rien à juger ;
  // le moteur (`blocking_reason`) refuse de le noter, et ce compte doit
  // refuser de le promettre. Ce test échoue avec `messages.length > 0`.
  assert.equal(awarenessMissing([attempt(null, [""])]), 0);
  assert.equal(awarenessMissing([attempt(null, ["   "])]), 0);
});

test("un seul tour d'assistant non vide suffit à rendre une conversation jugeable", () => {
  // Symétrique du test précédent : dès qu'un tour a répondu quelque chose,
  // même au milieu d'autres tours vides, le moteur juge la conversation.
  assert.equal(awarenessMissing([attempt(null, ["", "quelque chose", ""])]), 1);
});
