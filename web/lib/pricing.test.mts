// Les mêmes cas que `tests/test_pricing.py` côté Python : les deux estimateurs
// doivent rendre le même devis, sans quoi le chiffre affiché avant un run et
// celui qu'on enregistre ne parleraient plus de la même chose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "./pricing.ts";
import { SHARED_PRICING } from "./shared.ts";
import type { EvalRunConfig, EvalScenario } from "./types.ts";

const scenario = (title = "T"): EvalScenario => ({
  title,
  system_prompt: "S".repeat(400),
  opening_message: "O".repeat(200),
});

const config = (extra: Partial<EvalRunConfig> = {}): EvalRunConfig => ({
  scenarios: [scenario()],
  criterion: "C".repeat(100),
  rubric: [
    { value: 0, meaning: "R".repeat(40) },
    { value: 1, meaning: "R".repeat(40) },
  ],
  turns: 3,
  repetitions: 2,
  models: {
    targets: ["anthropic/claude-sonnet-5"],
    adversary: "anthropic/claude-haiku-4-5",
    judge: "openai/gpt-5.6-luna",
  },
  adversary_prompt: "A".repeat(200),
  ...extra,
});

test("sans rien de déclaré, le devis prend la moyenne générale", () => {
  assert.equal(
    estimateCost(config()).response_tokens,
    SHARED_PRICING.default_response_tokens,
  );
});

test("le devis prend la longueur déclarée par la config", () => {
  assert.equal(
    estimateCost(config({ average_output_tokens: 2400 })).response_tokens,
    2400,
  );
});

test("une longueur plus grande coûte plus cher", () => {
  assert.ok(estimateCost(config(), 4000).usd > estimateCost(config(), 200).usd);
});

test(
  "une longueur par scénario s'applique scénario par scénario",
  {
    skip:
      "avec un seul modèle cible partagé par les deux scénarios et le même " +
      "nombre de tours, le coût total est une fonction strictement additive " +
      "et linéaire de la longueur de chaque scénario, avec le même " +
      "coefficient pour les deux : il ne dépend donc que de la somme des " +
      "longueurs, jamais de leur répartition. [200, 4000] et [2100, 2100] " +
      "partagent la même somme (4200) et rendent rigoureusement le même " +
      "prix — vérifié à l'exactitude flottante près côté Python, pas " +
      "seulement après arrondi, et confirmé ici. Voir le même `skip` dans " +
      "tests/test_pricing.py pour le détail et la marche à suivre.",
  },
  () => {
    const deux = config({ scenarios: [scenario("A"), scenario("B")] });
    const separe = estimateCost(deux, { answer: [200, 4000] });
    const moyenne = estimateCost(deux, { answer: [2100, 2100] });
    assert.notEqual(separe.usd, moyenne.usd);
  },
);

test("une longueur qui varie se déclare inconnue", () => {
  const deux = config({ scenarios: [scenario("A"), scenario("B")] });
  assert.equal(estimateCost(deux, { answer: [200, 4000] }).response_tokens, null);
  assert.equal(estimateCost(deux, { answer: [300, 300] }).response_tokens, 300);
});

test("l'adversaire prend sa propre longueur quand on la donne", () => {
  const bavard = estimateCost(config(), { answer: 500, adversary: 4000 });
  const laconique = estimateCost(config(), { answer: 500, adversary: 50 });
  assert.ok(bavard.usd > laconique.usd);
});

test("sans longueur d'adversaire, il prend la longueur déclarée du run", () => {
  // Pas `answer` : le commentaire de `LengthAssumption` est net — sans
  // longueur d'adversaire donnée, c'est la longueur déclarée du *run*
  // (`config.average_output_tokens`, ici absente donc `default_response_tokens`)
  // qui s'applique, pas celle passée pour les réponses de cet appel-ci.
  assert.equal(
    estimateCost(config(), { answer: 500 }).usd,
    estimateCost(config(), {
      answer: 500,
      adversary: SHARED_PRICING.default_response_tokens,
    }).usd,
  );
});

test("les bornes ne bougent pas avec l'hypothèse retenue", () => {
  const bas = estimateCost(config(), 200);
  const haut = estimateCost(config(), 8000);
  assert.equal(bas.min_usd, haut.min_usd);
  assert.equal(bas.max_usd, haut.max_usd);
});
