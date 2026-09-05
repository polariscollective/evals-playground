// La règle d'un plafond valide, sans Supabase ni session : voir profile-caps.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capProblem, profilePatchProblem } from "./profile-caps.ts";

test("un nombre positif passe, entier ou non", () => {
  assert.equal(capProblem(2), null);
  assert.equal(capProblem(0.5), null);
  assert.equal(capProblem(0.0001), null);
});

test("zéro passe : c'est le frein d'urgence", () => {
  // À zéro, tout devis strictement positif est refusé — les agents de cette
  // personne ne dépensent plus rien. C'est le seul geste qui coupe vite, et
  // l'interdire fermait la porte qu'on croyait avoir laissée ouverte.
  assert.equal(capProblem(0), null);
});

test("le négatif est refusé — il se lirait comme zéro en disant autre chose", () => {
  assert.notEqual(capProblem(-1), null);
});

test("un plafond démesuré est refusé : c'est une faute de frappe", () => {
  // Un run coûte des centimes à quelques dollars, les défauts sont 2 et 10.
  // Un plafond qu'une glissade de clavier peut lever ne protège de rien.
  assert.equal(capProblem(100), null);
  assert.notEqual(capProblem(101), null);
  assert.notEqual(capProblem(1000), null);
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

test("le conseil seul passe : c'est la requête de la page des scénarios", () => {
  assert.equal(profilePatchProblem({ scenario_advice: "Ma règle." }), null);
});

test("les plafonds seuls passent : c'est la requête de la page de profil", () => {
  assert.equal(
    profilePatchProblem({ max_usd_per_run: 2, max_usd_per_hour: 10 }),
    null,
  );
});

test("le conseil et un seul plafond sont refusés ensemble", () => {
  // Choisir lequel des deux écraser serait arbitraire pour qui a envoyé la
  // requête — un seul plafond suffit à rendre le corps mixte.
  assert.notEqual(
    profilePatchProblem({ scenario_advice: "Ma règle.", max_usd_per_run: 2 }),
    null,
  );
});

test("le conseil et les deux plafonds sont refusés ensemble", () => {
  assert.notEqual(
    profilePatchProblem({
      scenario_advice: "Ma règle.",
      max_usd_per_run: 2,
      max_usd_per_hour: 10,
    }),
    null,
  );
});

test("un corps vide passe : rien à croiser", () => {
  // `undefined` partout veut dire « ne touche à rien » côté route, jamais un
  // conflit — c'est ce que reçoit la route quand le JSON envoyé ne parse pas.
  assert.equal(profilePatchProblem({}), null);
});
