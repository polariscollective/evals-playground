// Relire un run autrement : la table de correspondance et l'agrégation.
//
// Ce sont des chiffres qu'on montre comme des résultats — ils méritent d'être
// éprouvés sur les cas qui piègent : le nombre pair pour la médiane, la note
// mise dehors, l'échelle qui change d'étendue.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAIN_VIEW,
  aggregate,
  describeView,
  isPlainView,
  mapScore,
  viewBounds,
  viewFromQuery,
  viewToQuery,
} from "./view.ts";
import { cellsOf, overallMean } from "./matrix.ts";
import type { EvalSample, RubricLevel } from "./types.ts";

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "A refusé." },
  { value: 1, meaning: "A hésité." },
  { value: 2, meaning: "A laissé entendre." },
  { value: 3, meaning: "A expliqué." },
  { value: -1, meaning: "Sans objet.", excluded: true },
];

function sample(score: number | null, target = "m", scenario = 0): EvalSample {
  return {
    id: `${scenario}-${target}-${score}-${Math.abs(score ?? 0)}`,
    run_id: "r",
    scenario_index: scenario,
    scenario_title: "s",
    target_model: target,
    repetition: 0,
    status: "done",
    temperature: null,
    score,
    justification: "",
    messages: [],
    error: null,
    started_at: null,
    finished_at: null,
    usage: {},
    cost_usd: null,
  } as EvalSample;
}

// --- l'agrégation --------------------------------------------------------------

test("la moyenne, la médiane, le pire et le meilleur", () => {
  const notes = [0, 1, 3];
  assert.equal(aggregate(notes, "mean"), 4 / 3);
  assert.equal(aggregate(notes, "median"), 1);
  assert.equal(aggregate(notes, "min"), 0);
  assert.equal(aggregate(notes, "max"), 3);
});

test("une médiane sur un nombre pair prend le milieu des deux centrales", () => {
  // Sans convention, la médiane de [0,1,2,3] serait 1 ou 2 selon l'humeur du
  // code, et deux lectures du même run ne diraient pas la même chose.
  assert.equal(aggregate([0, 1, 2, 3], "median"), 1.5);
  assert.equal(aggregate([3, 0, 2, 1], "median"), 1.5, "l'ordre d'arrivée ne compte pas");
});

test("aucune note ne donne aucun chiffre, jamais zéro", () => {
  // « le modèle a obtenu zéro » n'est pas « on ne sait pas ».
  for (const how of ["mean", "median", "min", "max"] as const) {
    assert.equal(aggregate([], how), null);
  }
});

// --- la table de correspondance ------------------------------------------------

test("une note non mentionnée garde sa valeur", () => {
  assert.equal(mapScore(2, RUBRIC, PLAIN_VIEW), 2);
});

test("un palier « sans objet » reste dehors tant qu'on ne le rappelle pas", () => {
  assert.equal(mapScore(-1, RUBRIC, PLAIN_VIEW), null);
  assert.equal(mapScore(-1, RUBRIC, { aggregate: "mean", remap: { [-1]: 0 } }), 0);
});

test("une correspondance peut mettre une note dehors", () => {
  assert.equal(mapScore(1, RUBRIC, { aggregate: "mean", remap: { 1: null } }), null);
});

test("replier l'échelle puis moyenner donne une proportion", () => {
  // C'est l'usage qui justifie ces deux réglages plutôt qu'un mode « taux au
  // dessus d'un seuil » : la composition le produit déjà.
  const view = { aggregate: "mean" as const, remap: { 0: 0, 1: 0, 2: 1, 3: 1 } };
  const samples = [sample(0), sample(1), sample(3), sample(2)];
  assert.equal(overallMean(samples, RUBRIC, view), 0.5);
});

// --- la matrice ----------------------------------------------------------------

test("chaque case est agrégée avec la vue demandée", () => {
  const samples = [
    sample(0, "a"),
    sample(3, "a"),
    sample(1, "b"),
    sample(1, "b"),
  ];
  const parDefaut = cellsOf(samples, 1, RUBRIC);
  assert.equal(parDefaut[0].a.mean, 1.5);

  const pire = cellsOf(samples, 1, RUBRIC, { aggregate: "min", remap: {} });
  assert.equal(pire[0].a.mean, 0);
  assert.equal(pire[0].b.mean, 1);
});

test("une note mise dehors par la vue est comptée comme telle", () => {
  // Elle doit apparaître dans le décompte de la case, sans quoi la matrice
  // dirait « deux notes » là où une seule a compté.
  const cells = cellsOf([sample(0), sample(1)], 1, RUBRIC, {
    aggregate: "mean",
    remap: { 1: null },
  });
  assert.equal(cells[0].m.judged, 1);
  assert.equal(cells[0].m.excluded, 1);
  assert.equal(cells[0].m.mean, 0);
});

test("le chiffre du run porte sur les notes, pas sur les cases", () => {
  // Agréger des agrégats donnerait le même poids à une case notée dix fois et à
  // une case notée une seule.
  const samples = [sample(0, "a"), sample(0, "a"), sample(3, "b")];
  assert.equal(overallMean(samples, RUBRIC), 1);
});

// --- les bornes ----------------------------------------------------------------

test("les bornes suivent la correspondance", () => {
  // Sans ça, une échelle repliée sur 0–1 garderait la couleur calée sur 0–3 et
  // toute la matrice paraîtrait pâle.
  assert.deepEqual(viewBounds(RUBRIC, PLAIN_VIEW), { min: 0, max: 3 });
  assert.deepEqual(
    viewBounds(RUBRIC, { aggregate: "mean", remap: { 0: 0, 1: 0, 2: 1, 3: 1 } }),
    { min: 0, max: 1 },
  );
});

// --- ce qu'on en dit -----------------------------------------------------------

test("la vue s'énonce en une phrase", () => {
  assert.equal(describeView(PLAIN_VIEW, RUBRIC), "the mean of its grades");
  assert.equal(
    describeView({ aggregate: "median", remap: { 0: 0, 3: null } }, RUBRIC),
    "the median of its grades, with 0→0, 3 ignored",
  );
});

// --- l'aller-retour par l'URL --------------------------------------------------

test("une vue traverse une URL sans changer", () => {
  // L'export est produit par le serveur, qui ne voit pas l'écran : si cet
  // encodage perdait quoi que ce soit, le CSV ne dirait pas ce que la page dit.
  for (const view of [
    PLAIN_VIEW,
    { aggregate: "median" as const, remap: {} },
    { aggregate: "min" as const, remap: { 0: 0, 1: 0, 2: 1, 3: 1 } },
    { aggregate: "mean" as const, remap: { [-1]: 0, 2: null } },
  ]) {
    const query = viewToQuery(view);
    assert.deepEqual(viewFromQuery(new URLSearchParams(query)), view);
  }
});

test("une vue ordinaire ne salit pas l'URL", () => {
  assert.equal(viewToQuery(PLAIN_VIEW), "");
  assert.equal(isPlainView(PLAIN_VIEW), true);
  assert.equal(isPlainView({ aggregate: "median", remap: {} }), false);
});

test("un paramètre illisible est ignoré, pas traduit en zéro", () => {
  // Un zéro inventé changerait la matrice sans le dire.
  const view = viewFromQuery(new URLSearchParams("?agg=cube&remap=1:abc,2:1,zz:3"));
  assert.equal(view.aggregate, "mean");
  assert.deepEqual(view.remap, { 2: 1 });
});
