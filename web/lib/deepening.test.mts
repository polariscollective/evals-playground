// Approfondir est ce que ce produit sait faire de plus cher : un prix faux
// ici serait pire que pas de prix du tout.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost, estimateDeepening } from "./pricing.ts";
import type { EvalRunConfig } from "./types";

const CONFIG = {
  scenarios: [
    { title: "T", system_prompt: "Tu assistes.", opening_message: "Fais-le." },
  ],
  criterion: "Ce qu'il a fait.",
  rubric: [
    { value: 0, meaning: "A tenu." },
    { value: 1, meaning: "A cédé." },
  ],
  turns: 4,
  repetitions: 1,
  // Le juge porte un modèle différent de celui évalué et de l'adversaire :
  // `estimateTokens` cumule les jetons d'un modèle qui tient plusieurs rôles
  // dans une seule entrée de `per_model` (voir son commentaire sur les rôles
  // qui « cumulent ») — avec un seul et même modèle partout, la ligne du juge
  // se serait confondue avec celle du modèle évalué, et le test dessous
  // n'aurait plus isolé ce qu'il prétend isoler. Un couple onéreux (sonnet /
  // opus, plutôt que haiku partout) évite en prime qu'un arrondi à quatre
  // décimales sur un montant de quelques centimes ne fausse la comparaison
  // ×10 du test « le devis suit le nombre de cases ».
  models: {
    targets: ["anthropic/claude-sonnet-5"],
    adversary: "anthropic/claude-sonnet-5",
    judge: "anthropic/claude-opus-5",
  },
  adversary_prompt: "Insiste.",
} as EvalRunConfig;

test("continuer coûte moins cher que rejouer depuis le début", () => {
  // C'est tout l'intérêt : les tours déjà joués ne sont pas repayés.
  const àNeuf = estimateCost({ ...CONFIG, turns: 8 }, null);
  const continué = estimateDeepening(CONFIG, 4, 8, 1);
  assert.ok(
    continué.usd < àNeuf.usd,
    `continuer (${continué.usd}) devrait coûter moins que rejouer (${àNeuf.usd})`,
  );
});

test("continuer coûte plus cher que les mêmes tours joués à froid", () => {
  // Chaque tour renvoie tout l'historique : reprendre à quatre tours traîne
  // déjà quatre tours de conversation, là où un run neuf de quatre tours
  // part de rien. Un devis qui l'ignorerait sous-estimerait la seule
  // fonctionnalité chère du produit.
  const àFroid = estimateCost({ ...CONFIG, turns: 4 }, null);
  const continué = estimateDeepening(CONFIG, 4, 8, 1);
  assert.ok(
    continué.usd > àFroid.usd,
    `continuer (${continué.usd}) devrait coûter plus que quatre tours à froid (${àFroid.usd})`,
  );
});

test("le juge est payé pour la conversation entière, pas pour les tours ajoutés", () => {
  // Il relit tout : son coût ne dépend pas de l'endroit où l'on a repris.
  // Approfondir jusqu'à huit tours et jouer huit tours à neuf lui donnent la
  // même conversation à lire, donc la même facture — c'est ce qui distingue
  // son coût de celui des modèles, qui, lui, s'allège d'une reprise.
  const àNeuf = estimateCost({ ...CONFIG, turns: 8 }, null);
  const continué = estimateDeepening(CONFIG, 4, 8, 1);
  const juge = (e: typeof àNeuf) =>
    e.per_model.filter((m) => m.model === CONFIG.models.judge);

  // Le juge apparaît une fois par conversation dans les deux devis.
  assert.equal(juge(continué).length, juge(àNeuf).length);
  assert.equal(
    juge(continué)[0].input_tokens,
    juge(àNeuf)[0].input_tokens,
    "le juge relit la même conversation dans les deux cas",
  );
});

test("le devis suit le nombre de cases", () => {
  const une = estimateDeepening(CONFIG, 4, 8, 1);
  const dix = estimateDeepening(CONFIG, 4, 8, 10);
  assert.ok(Math.abs(dix.usd - une.usd * 10) < une.usd * 0.001);
  assert.equal(dix.conversations, 10);
});

test("approfondir de zéro tour ne coûte rien", () => {
  const rien = estimateDeepening(CONFIG, 4, 4, 5);
  assert.equal(rien.usd, 0);
  assert.equal(rien.model_calls, 0);
});
