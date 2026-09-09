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
  // `awake` absent — never `pending` — is the shape "this run has no
  // no awareness judge", distinct from "it has one that has not passed over it
  // yet". Neither lights the badge.
  const cells = cellsOf([sample({ awake: undefined })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("a cell's count follows the indicator's threshold, not another", () => {
  const cells = cellsOf(
    [
      // Just under the alarm: counts in the indicator as the "vague band", but
      // not in `flagged`, and not in this marker.
      sample({ awake: verdict(AWARENESS_ALARM - 1) }),
      sample({ awake: verdict(AWARENESS_ALARM) }),
      sample({ awake: verdict(10) }),
    ],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 2);
});

test("a fallen awareness judge never counts as a signal", () => {
  // "It could say nothing" is not "it saw something": confusing the two would
  // sound a cell marker on a failure, not on a sign.
  const cells = cellsOf([sample({ awake: verdict(null, "error") })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("an awareness judge still pending does not count either", () => {
  const cells = cellsOf([sample({ awake: verdict(null, "pending") })], 1);
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].awareness_flagged, 0);
});

test("a cell's marker counts the attempts, not the cells", () => {
  // Two flagged attempts out of five is not the same as one out of five: the
  // marker must say how many, not merely that there are some.
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

test("invariant: the sum of the cell markers falls back on the run indicator's figure", () => {
  // This is the rule the brief places above all others: if the run announces N,
  // the sum of the markers over every cell must make N. A disagreement between
  // the two would break the one promise that makes the marker useful. What is
  // shared is no longer only `AWARENESS_ALARM`: `cellsOf` and
  // `awarenessSummary` both call `isAwarenessFlagged`.
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

// --- the principal, and it alone --------------------------------------------

test("a pending or running cell counts as waiting, whatever the principal", () => {
  const cells = cellsOf(
    [sample({ status: "pending" }), sample({ status: "running" })],
    1,
  );
  assert.equal(cells[0]["anthropic/claude-haiku-4-5"].pending, 2);
});

test("a cancelled cell never happened, and is not a failure", () => {
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

test("a grade from the principal feeds the cell's mean", () => {
  const cells = cellsOf(
    [
      sample({ scenario_index: 0, principal: verdict(0) }),
      sample({ scenario_index: 0, principal: verdict(2) }),
    ],
    1,
    [
      { value: 0, meaning: "Held out." },
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
    { scenario_index: 0, principal: verdict(0) },
    { scenario_index: 0, principal: verdict(2) },
    { scenario_index: 0, principal: verdict(null, "pending") },
    { scenario_index: 0, principal: verdict(null, "error") },
  ]);
  assert.equal(mean, 1);
});
