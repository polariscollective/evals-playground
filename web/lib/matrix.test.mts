// La matrice, côté lecture : le compte d'éveil par case en est la partie la
// plus jeune, et la plus facile à faire dériver du voyant du run (awareness.ts)
// si on ne partage pas AWARENESS_ALARM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AWARENESS_ALARM, awarenessSummary, type JudgeVerdict } from "./awareness.ts";
import { cellsOf, overallMean, progressOf, type MatrixSample } from "./matrix.ts";
import type { JudgeScoreStatus } from "./types.ts";

function verdict(
  score: number | null,
  status: JudgeScoreStatus = "done",
): JudgeVerdict {
  return { status, score };
}

function sample(overrides: Partial<MatrixSample> = {}): MatrixSample {
  return {
    scenario_index: 0,
    target_model: "anthropic/claude-haiku-4-5",
    status: "done",
    cost_usd: null,
    principal: verdict(0),
    awake: undefined,
    ...overrides,
  };
}

// --- le badge d'éveil, généralisé au type -----------------------------------

test("une case sans signal d'éveil ne porte pas de marqueur", () => {
  const cells = cellsOf(
    [sample({ awake: verdict(1) }), sample({ awake: verdict(3) })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("aucune liaison d'éveil sur le run : jamais de marqueur", () => {
  // `awake` absent — jamais `pending` — est la forme que prend « ce run n'a
  // pas de juge d'éveil », distincte d'« il en a un qui n'est pas encore
  // passé ». Ni l'une ni l'autre n'allume le badge.
  const cells = cellsOf([sample({ awake: undefined })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("le compte de case suit le seuil du voyant, pas un autre", () => {
  const cells = cellsOf(
    [
      // Juste sous l'alarme : compte dans le voyant comme « bande
      // intermédiaire », mais pas dans `flagged`, et pas dans ce marqueur.
      sample({ awake: verdict(AWARENESS_ALARM - 1) }),
      sample({ awake: verdict(AWARENESS_ALARM) }),
      sample({ awake: verdict(10) }),
    ],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("un juge d'éveil tombé ne compte jamais comme un signal", () => {
  // « Il n'a rien pu dire » n'est pas « il a vu quelque chose » : le confondre
  // ferait sonner un marqueur de case sur une panne, pas sur un signe.
  const cells = cellsOf([sample({ awake: verdict(null, "error") })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("un juge d'éveil encore en attente ne compte pas non plus", () => {
  const cells = cellsOf([sample({ awake: verdict(null, "pending") })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("le marqueur d'une case compte les tentatives, pas les cases", () => {
  // Deux tentatives signalées sur cinq n'est pas la même chose qu'une sur
  // cinq : le marqueur doit dire combien, pas seulement « il y en a ».
  const samples = Array.from({ length: 5 }, (_, repetition) =>
    sample({ awake: verdict(repetition < 2 ? AWARENESS_ALARM : 1) }),
  );
  const cells = cellsOf(samples, 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("le compte est indépendant du statut de la case et du verdict du principal", () => {
  // Le juge d'éveil note une conversation que le principal ait pu la trancher
  // ou non — une case en panne d'exécution, en panne côté principal, ou
  // jamais jugée par lui, garde son signal.
  const cells = cellsOf(
    [
      sample({ status: "error", principal: verdict(null, "pending"), awake: verdict(9) }),
      sample({ status: "done", principal: verdict(null, "error"), awake: verdict(9) }),
    ],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("invariant : la somme des marqueurs de case retombe sur le chiffre du voyant du run", () => {
  // C'est la règle que le brief pose au-dessus de tout le reste : si le run
  // annonce N, la somme des marqueurs de toutes les cases doit faire N. Un
  // désaccord entre les deux romprait la seule promesse qui rend le marqueur
  // utile. Le partage n'est plus seulement `AWARENESS_ALARM` : `cellsOf` et
  // `awarenessSummary` appellent tous deux `isAwarenessFlagged`.
  const samples: MatrixSample[] = [
    sample({ scenario_index: 0, target_model: "a/1", awake: verdict(8) }),
    sample({ scenario_index: 0, target_model: "a/1", awake: verdict(2) }),
    sample({ scenario_index: 0, target_model: "b/2", awake: verdict(7) }),
    sample({ scenario_index: 1, target_model: "a/1", awake: verdict(10) }),
    sample({ scenario_index: 1, target_model: "b/2", awake: verdict(null, "error") }),
    sample({ scenario_index: 1, target_model: "b/2", awake: verdict(1) }),
  ];

  const cells = cellsOf(samples, 2);
  const totalFromCells = cells.reduce(
    (total, row) =>
      total +
      Object.values(row).reduce((sub, cell) => sub + cell.awareness_flagged, 0),
    0,
  );
  const totalFromRun = awarenessSummary(samples.map((s) => s.awake!)).flagged;

  assert.equal(totalFromRun, 3);
  assert.equal(totalFromCells, totalFromRun);
});

// --- le principal, et lui seul -----------------------------------------------

test("une case pending ou running compte en attente, quel que soit le principal", () => {
  const cells = cellsOf(
    [sample({ status: "pending" }), sample({ status: "running" })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].pending, 2);
});

test("une case cancelled ne s'est jamais faite, et n'est pas une panne", () => {
  const cells = cellsOf([sample({ status: "cancelled" })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].cancelled, 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].errored, 0);
});

test("l'exécution en panne compte en panne, sans regarder le principal", () => {
  const cells = cellsOf([sample({ status: "error", principal: verdict(0) })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].errored, 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].judged, 0);
});

test("une conversation jouée dont le principal n'est pas encore passé compte en attente", () => {
  const cells = cellsOf(
    [sample({ status: "done", principal: verdict(null, "pending") })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].pending, 1);
});

test("le principal tombé sur une conversation valide compte en panne", () => {
  const cells = cellsOf(
    [sample({ status: "done", principal: verdict(null, "error") })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].errored, 1);
});

test("le principal done sans note (vide ou hors échelle) compte non jugée", () => {
  const cells = cellsOf(
    [sample({ status: "done", principal: verdict(null, "done") })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].unjudged, 1);
});

test("une note du principal alimente la moyenne de la case", () => {
  const cells = cellsOf(
    [
      sample({ principal: verdict(0) }),
      sample({ principal: verdict(2) }),
    ],
    1,
    [
      { value: 0, meaning: "A tenu." },
      { value: 2, meaning: "A cédé." },
    ],
  );
  const cell = cells[0]["anthropic/claude-haiku-4-5"];
  assert.equal(cell.judged, 2);
  assert.equal(cell.mean, 1);
});

test("progressOf ne regarde que le statut d'exécution", () => {
  const progress = progressOf([
    { status: "done" },
    { status: "running" },
    { status: "pending" },
    { status: "error" },
    { status: "cancelled" },
  ]);
  assert.deepEqual(progress, {
    total: 5,
    done: 1,
    running: 1,
    pending: 1,
    errored: 1,
    cancelled: 1,
  });
});

test("overallMean ignore pourquoi le principal n'a pas noté", () => {
  const mean = overallMean([
    { principal: verdict(0) },
    { principal: verdict(2) },
    { principal: verdict(null, "pending") },
    { principal: verdict(null, "error") },
  ]);
  assert.equal(mean, 1);
});
