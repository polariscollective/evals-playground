// La matrice, côté lecture : le compte d'éveil par case en est la partie la
// plus jeune, et la plus facile à faire dériver du voyant du run (awareness.ts)
// si on ne partage pas AWARENESS_ALARM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AWARENESS_ALARM, awarenessSummary } from "./awareness.ts";
import { cellsOf } from "./matrix.ts";
import type { EvalSample } from "./types.ts";

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
    awareness_score: null,
    awareness_justification: "",
    awareness_error: null,
    ...overrides,
  };
}

test("une case sans signal d'éveil ne porte pas de marqueur", () => {
  const cells = cellsOf(
    [sample({ awareness_score: 1 }), sample({ awareness_score: 3 })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("le compte de case suit le seuil du voyant, pas un autre", () => {
  const cells = cellsOf(
    [
      // Juste sous l'alarme : compte dans le voyant comme « bande
      // intermédiaire », mais pas dans `flagged`, et pas dans ce marqueur.
      sample({ repetition: 0, awareness_score: AWARENESS_ALARM - 1 }),
      sample({ repetition: 1, awareness_score: AWARENESS_ALARM }),
      sample({ repetition: 2, awareness_score: 10 }),
    ],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("un juge d'éveil tombé ne compte jamais comme un signal", () => {
  // « Il n'a rien pu dire » n'est pas « il a vu quelque chose » : le confondre
  // ferait sonner un marqueur de case sur une panne, pas sur un signe.
  const cells = cellsOf(
    [sample({ awareness_score: null, awareness_error: "boom" })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("le marqueur d'une case compte les tentatives, pas les cases", () => {
  // Deux tentatives signalées sur cinq n'est pas la même chose qu'une sur
  // cinq : le marqueur doit dire combien, pas seulement « il y en a ».
  const samples = Array.from({ length: 5 }, (_, repetition) =>
    sample({
      repetition,
      awareness_score: repetition < 2 ? AWARENESS_ALARM : 1,
    }),
  );
  const cells = cellsOf(samples, 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("le compte est indépendant du statut de la case", () => {
  // Le juge d'éveil note une conversation que le juge principal ait pu la
  // trancher ou non — une case en panne, ou jamais jugée, garde son signal.
  const cells = cellsOf(
    [
      sample({ repetition: 0, status: "error", score: null, awareness_score: 9 }),
      sample({ repetition: 1, status: "done", score: null, awareness_score: 9 }),
    ],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("invariant : la somme des marqueurs de case retombe sur le chiffre du voyant du run", () => {
  // C'est la règle que le brief pose au-dessus de tout le reste : si le run
  // annonce N, la somme des marqueurs de toutes les cases doit faire N. Un
  // désaccord entre les deux romprait la seule promesse qui rend le marqueur
  // utile.
  const samples: EvalSample[] = [
    sample({ scenario_index: 0, target_model: "a/1", repetition: 0, awareness_score: 8 }),
    sample({ scenario_index: 0, target_model: "a/1", repetition: 1, awareness_score: 2 }),
    sample({ scenario_index: 0, target_model: "b/2", repetition: 0, awareness_score: 7 }),
    sample({ scenario_index: 1, target_model: "a/1", repetition: 0, awareness_score: 10 }),
    sample({ scenario_index: 1, target_model: "b/2", repetition: 0, awareness_score: null, awareness_error: "boom" }),
    sample({ scenario_index: 1, target_model: "b/2", repetition: 1, awareness_score: 1 }),
  ];

  const cells = cellsOf(samples, 2);
  const totalFromCells = cells.reduce(
    (total, row) =>
      total +
      Object.values(row).reduce((sub, cell) => sub + cell.awareness_flagged, 0),
    0,
  );
  const totalFromRun = awarenessSummary(samples).flagged;

  assert.equal(totalFromRun, 3);
  assert.equal(totalFromCells, totalFromRun);
});
