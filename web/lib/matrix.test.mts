// The matrix, on the reading side: the per-cell awareness count is its newest
// part, and the easiest to let drift from the run's indicator (awareness.ts)
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

// --- the awareness badge, generalised to the type ---------------------------

test("a cell with no awareness signal carries no marker", () => {
  const cells = cellsOf(
    [sample({ awake: verdict(1) }), sample({ awake: verdict(3) })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("no awareness link on the run: never a marker", () => {
  // `awake` absent — jamais `pending` — est la forme que prend « ce run n'a
  // no awareness judge", distinct from "it has one that has not passed over it
  // yet". Neither lights the badge.
  const cells = cellsOf([sample({ awake: undefined })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("le compte de case suit le seuil du voyant, pas un autre", () => {
  const cells = cellsOf(
    [
      // Juste sous l'alarme : compte dans le voyant comme « bande
      // band", but not in `flagged`, and not in this marker.
      sample({ awake: verdict(AWARENESS_ALARM - 1) }),
      sample({ awake: verdict(AWARENESS_ALARM) }),
      sample({ awake: verdict(10) }),
    ],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("a fallen awareness judge never counts as a signal", () => {
  // « Il n'a rien pu dire » n'est pas « il a vu quelque chose » : le confondre
  // ferait sonner un marqueur de case sur une panne, pas sur un signe.
  const cells = cellsOf([sample({ awake: verdict(null, "error") })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("an awareness judge still pending does not count either", () => {
  const cells = cellsOf([sample({ awake: verdict(null, "pending") })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("le marqueur d'une case compte les tentatives, pas les cases", () => {
  // Two flagged attempts out of five is not the same as one out of
  // cinq : le marqueur doit dire combien, pas seulement « il y en a ».
  const samples = Array.from({ length: 5 }, (_, repetition) =>
    sample({ awake: verdict(repetition < 2 ? AWARENESS_ALARM : 1) }),
  );
  const cells = cellsOf(samples, 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("the count is independent of the cell's status and the principal's verdict", () => {
  // The awareness judge grades a conversation whether or not the principal
  // could decide on it — a cell that failed to run, failed on the principal's
  // side, or was never graded by it, keeps its signal.
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
  // This is the rule the brief places above all others: if the run
  // annonce N, la somme des marqueurs de toutes les cases doit faire N. Un
  // a disagreement between the two would break the one promise that makes the
  // marker
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

test("a failed run counts as failed, without looking at the principal", () => {
  const cells = cellsOf([sample({ status: "error", principal: verdict(0) })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].errored, 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].judged, 0);
});

test("a played conversation whose principal has not passed yet counts as pending", () => {
  const cells = cellsOf(
    [sample({ status: "done", principal: verdict(null, "pending") })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].pending, 1);
});

test("the principal fallen on a valid conversation counts as failed", () => {
  const cells = cellsOf(
    [sample({ status: "done", principal: verdict(null, "error") })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].errored, 1);
});

test("the principal done with no grade (empty or off the scale) counts ungraded", () => {
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
      { value: 2, meaning: "Gave in." },
    ],
  );
  const cell = cells[0]["anthropic/claude-haiku-4-5"];
  assert.equal(cell.judged, 2);
  assert.equal(cell.mean, 1);
});

test("progressOf looks only at the execution status", () => {
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

test("overallMean ignores why the principal did not grade", () => {
  const mean = overallMean([
    { principal: verdict(0) },
    { principal: verdict(2) },
    { principal: verdict(null, "pending") },
    { principal: verdict(null, "error") },
  ]);
  assert.equal(mean, 1);
});
