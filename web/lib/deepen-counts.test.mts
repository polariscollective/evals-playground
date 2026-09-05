// Les comptes que le panneau d'extension affiche à côté de chaque palier, et
// celui de la sélection qu'il envoie au devis.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countAllGraded,
  countsByLevel,
  countsForSelection,
  estimateDeepeningCost,
  groupByModelAndDepth,
  samplesForSelection,
} from "./deepen-counts.ts";
import { addEstimates, estimateDeepening } from "./pricing.ts";
import type { EvalRunConfig, EvalSample, RubricLevel } from "./types.ts";

function sample(overrides: Partial<EvalSample> = {}): EvalSample {
  return {
    id: "s",
    run_id: "r",
    scenario_index: 0,
    scenario_title: "T",
    target_model: "anthropic/claude-haiku-4-5",
    repetition: 0,
    status: "done",
    temperature: null,
    turns_done: 4,
    score: 0,
    justification: "",
    messages: [],
    error: null,
    started_at: null,
    finished_at: null,
    usage: {},
    cost_usd: null,
    ...overrides,
  };
}

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "A tenu." },
  { value: 1, meaning: "A cédé." },
  { value: -1, meaning: "Sans objet.", excluded: true },
];

test("chaque palier compte ses essais, répartis par modèle", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 0, target_model: "a" }),
    sample({ score: 0, target_model: "b" }),
    sample({ score: 1, target_model: "a" }),
  ];
  const counts = countsByLevel(samples, RUBRIC);
  assert.equal(counts[0].total, 3);
  assert.deepEqual(counts[0].byModel, { a: 2, b: 1 });
  assert.equal(counts[1].total, 1);
  assert.deepEqual(counts[1].byModel, { a: 1 });
});

test("un palier que personne ne porte reste à zéro", () => {
  const counts = countsByLevel([sample({ score: 0 })], RUBRIC);
  assert.equal(counts[1].total, 0);
  assert.deepEqual(counts[1].byModel, {});
});

test("un palier hors moyenne compte quand même ses essais", () => {
  const counts = countsByLevel([sample({ score: -1 })], RUBRIC);
  assert.equal(counts[2].total, 1);
});

test("les essais en panne, en attente ou sans note ne comptent nulle part", () => {
  const samples = [
    sample({ status: "error", score: null }),
    sample({ status: "pending", score: null }),
    // Conversation vide ou note hors échelle : `done`, mais sans note.
    sample({ status: "done", score: null }),
  ];
  assert.deepEqual(
    countsByLevel(samples, RUBRIC).map((c) => c.total),
    [0, 0, 0],
  );
  assert.equal(countAllGraded(samples).total, 0);
});

test("« tous les essais notés » couvre tous les paliers, répartis par modèle", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 1, target_model: "b" }),
    sample({ score: -1, target_model: "a" }),
  ];
  const all = countAllGraded(samples);
  assert.equal(all.total, 3);
  assert.deepEqual(all.byModel, { a: 2, b: 1 });
});

test("la sélection null n'approfondit rien", () => {
  const samples = [sample({ score: 0 })];
  assert.deepEqual(countsForSelection(samples, null), { total: 0, byModel: {} });
});

test("la sélection \"all\" retrouve le même compte que countAllGraded", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 1, target_model: "b" }),
  ];
  assert.deepEqual(countsForSelection(samples, "all"), countAllGraded(samples));
});

test("une sélection de notes ne prend que les essais qui les portent", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 1, target_model: "b" }),
    sample({ score: -1, target_model: "a" }),
  ];
  const selected = countsForSelection(samples, [0, -1]);
  assert.equal(selected.total, 2);
  assert.deepEqual(selected.byModel, { a: 2 });
});

// --- le devis d'approfondir, groupé par profondeur de départ -----------------
//
// Après un premier approfondissement, les essais d'un run n'ont plus tous la
// même profondeur : seuls ceux qu'on avait choisis ont grandi. Un devis qui ne
// groupe que par modèle traite alors tout le monde comme s'il partait de
// `config.turns`, et sous-facture les essais restés en arrière.

test("samplesForSelection renvoie les essais eux-mêmes, pas seulement leur compte", () => {
  const a = sample({ score: 0, target_model: "a", turns_done: 4 });
  const b = sample({ score: 1, target_model: "b", turns_done: 8 });
  assert.deepEqual(samplesForSelection([a, b], "all"), [a, b]);
  assert.deepEqual(samplesForSelection([a, b], [0]), [a]);
  assert.deepEqual(samplesForSelection([a, b], null), []);
});

test("le regroupement sépare deux profondeurs de départ pour un même modèle", () => {
  const groups = groupByModelAndDepth(
    [
      { target_model: "a", turns_done: 4 },
      { target_model: "a", turns_done: 4 },
      { target_model: "a", turns_done: 8 },
      { target_model: "b", turns_done: 4 },
    ],
    4,
  );
  const byKey = Object.fromEntries(
    groups.map((g) => [`${g.target_model}@${g.turns_done}`, g.cells]),
  );
  assert.deepEqual(byKey, { "a@4": 2, "a@8": 1, "b@4": 1 });
});

test("un essai sans profondeur enregistrée retombe sur la profondeur de repli", () => {
  const groups = groupByModelAndDepth(
    [{ target_model: "a", turns_done: null }],
    4,
  );
  assert.deepEqual(groups, [{ target_model: "a", turns_done: 4, cells: 1 }]);
});

const DEEPEN_CONFIG: EvalRunConfig = {
  scenarios: [
    { title: "T", system_prompt: "Tu assistes.", opening_message: "Fais-le." },
  ],
  criterion: "Ce qu'il a fait.",
  rubric: [
    { value: 0, meaning: "A tenu." },
    { value: 1, meaning: "A cédé." },
  ],
  // Le run a déjà subi un premier approfondissement : sa profondeur officielle
  // est montée à 8, mais un essai qu'on n'avait pas choisi alors est resté à 4.
  turns: 8,
  repetitions: 1,
  models: {
    targets: ["anthropic/claude-sonnet-5"],
    adversary: "anthropic/claude-sonnet-5",
    judge: "anthropic/claude-opus-5",
  },
  adversary_prompt: "Insiste.",
};

test("le devis charge chaque groupe depuis sa vraie profondeur de départ", () => {
  const cells = [
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 4 },
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 8 },
  ];
  const juste = estimateDeepeningCost(DEEPEN_CONFIG, cells, 12, DEEPEN_CONFIG.turns);
  const attendu = addEstimates(
    estimateDeepening(DEEPEN_CONFIG, 4, 12, 1),
    estimateDeepening(DEEPEN_CONFIG, 8, 12, 1),
  );
  assert.deepEqual(juste, attendu);
});

test("grouper par modèle seul sous-estimerait l'essai resté en arrière", () => {
  // Le défaut corrigé : traiter les deux essais comme s'ils partaient tous
  // deux de `config.turns` (8) facturerait moins que ce qu'il reste
  // réellement à jouer à celui qui n'a jamais bougé de 4.
  const cells = [
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 4 },
    { target_model: DEEPEN_CONFIG.models.targets[0], turns_done: 8 },
  ];
  const juste = estimateDeepeningCost(DEEPEN_CONFIG, cells, 12, DEEPEN_CONFIG.turns)!;
  const sousEstime = estimateDeepening(DEEPEN_CONFIG, DEEPEN_CONFIG.turns, 12, cells.length);
  assert.ok(
    juste.usd > sousEstime.usd,
    `le devis juste (${juste.usd}) devrait dépasser celui groupé par modèle seul (${sousEstime.usd})`,
  );
});

test("sans essai à approfondir, aucun devis", () => {
  assert.equal(estimateDeepeningCost(DEEPEN_CONFIG, [], 12, DEEPEN_CONFIG.turns), null);
});
