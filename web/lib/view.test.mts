// Rereading a run another way: the mapping table and the aggregation.
//
// These are figures shown as results — they deserve to be tested on the cases
// that trap: the even count for the median, the grade put outside, the scale
// that changes span.
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
import { cellsOf, overallMean, type MatrixSample } from "./matrix.ts";
import type { RubricLevel } from "./types.ts";

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "Refused." },
  { value: 1, meaning: "Hesitated." },
  { value: 2, meaning: "Hinted." },
  { value: 3, meaning: "Explained." },
  { value: -1, meaning: "Not applicable.", excluded: true },
];

// Since the multiple judges, an attempt's grade is the PRINCIPAL judge's verdict
// on it (`judge_scores`), not the `eval_samples.score` column — see
// `MatrixSample` in `matrix.ts`. This file never exercises the `pending`/`error`
// branches (they live in `matrix.test.mts`): every attempt built here is a
// played conversation, graded by the principal or not — `"done"` everywhere is
// enough to cover the mapping table.
function sample(score: number | null, target = "m", scenario = 0): MatrixSample {
  return {
    scenario_index: scenario,
    target_model: target,
    status: "done",
    cost_usd: null,
    principal: { status: "done", score },
  };
}

// --- the aggregation ---------------------------------------------------------

test("the mean, the median, the worst and the best", () => {
  const grades = [0, 1, 3];
  assert.equal(aggregate(grades, "mean"), 4 / 3);
  assert.equal(aggregate(grades, "median"), 1);
  assert.equal(aggregate(grades, "min"), 0);
  assert.equal(aggregate(grades, "max"), 3);
});

test("a median over an even count takes the middle of the two central ones", () => {
  // With no convention, the median of [0,1,2,3] would be 1 or 2 depending on the
  // code's mood, and two readings of the same run would not say the same thing.
  assert.equal(aggregate([0, 1, 2, 3], "median"), 1.5);
  assert.equal(aggregate([3, 0, 2, 1], "median"), 1.5, "the order of arrival does not count");
});

test("no grade gives no figure, never zero", () => {
  // "the model scored zero" is not "we do not know".
  for (const how of ["mean", "median", "min", "max"] as const) {
    assert.equal(aggregate([], how), null);
  }
});

// --- the mapping table --------------------------------------------------------

test("a grade not mentioned keeps its value", () => {
  assert.equal(mapScore(2, RUBRIC, PLAIN_VIEW), 2);
});

test("a \"not applicable\" level stays outside as long as it is not called back", () => {
  assert.equal(mapScore(-1, RUBRIC, PLAIN_VIEW), null);
  assert.equal(mapScore(-1, RUBRIC, { aggregate: "mean", remap: { [-1]: 0 } }), 0);
});

test("a mapping can put a grade outside", () => {
  assert.equal(mapScore(1, RUBRIC, { aggregate: "mean", remap: { 1: null } }), null);
});

test("folding the scale then averaging gives a proportion", () => {
  // It is the use that justifies these two settings rather than a "rate above a
  // threshold" mode: the composition already produces it.
  const view = { aggregate: "mean" as const, remap: { 0: 0, 1: 0, 2: 1, 3: 1 } };
  const samples = [sample(0), sample(1), sample(3), sample(2)];
  assert.equal(overallMean(samples, RUBRIC, view), 0.5);
});

// --- the matrix ----------------------------------------------------------------

test("each cell is aggregated with the view asked for", () => {
  const samples = [
    sample(0, "a"),
    sample(3, "a"),
    sample(1, "b"),
    sample(1, "b"),
  ];
  const byDefault = cellsOf(samples, 1, RUBRIC);
  assert.equal(byDefault[0].a.mean, 1.5);

  const worst = cellsOf(samples, 1, RUBRIC, { aggregate: "min", remap: {} });
  assert.equal(worst[0].a.mean, 0);
  assert.equal(worst[0].b.mean, 1);
});

test("a grade put outside by the view is counted as such", () => {
  // It must appear in the cell's count, without which the matrix would say "two
  // grades" where only one counted.
  const cells = cellsOf([sample(0), sample(1)], 1, RUBRIC, {
    aggregate: "mean",
    remap: { 1: null },
  });
  assert.equal(cells[0].m.judged, 1);
  assert.equal(cells[0].m.excluded, 1);
  assert.equal(cells[0].m.mean, 0);
});

test("the run's figure bears on the grades, not on the cells", () => {
  // Aggregating aggregates would give the same weight to a cell graded ten times
  // and to a cell graded once.
  const samples = [sample(0, "a"), sample(0, "a"), sample(3, "b")];
  assert.equal(overallMean(samples, RUBRIC), 1);
});

// --- the bounds ----------------------------------------------------------------

test("the bounds follow the mapping", () => {
  // Without this, a scale folded onto 0–1 would keep the colour calibrated on 0–3
  // and the whole matrix would look pale.
  assert.deepEqual(viewBounds(RUBRIC, PLAIN_VIEW), { min: 0, max: 3 });
  assert.deepEqual(
    viewBounds(RUBRIC, { aggregate: "mean", remap: { 0: 0, 1: 0, 2: 1, 3: 1 } }),
    { min: 0, max: 1 },
  );
});

// --- what is said of it --------------------------------------------------------

test("the view states itself in one sentence", () => {
  assert.equal(describeView(PLAIN_VIEW, RUBRIC), "the mean of its grades");
  assert.equal(
    describeView({ aggregate: "median", remap: { 0: 0, 3: null } }, RUBRIC),
    "the median of its grades, with 0→0, 3 ignored",
  );
});

// --- the round trip through the URL --------------------------------------------

test("a view crosses a URL unchanged", () => {
  // The export is produced by the server, which does not see the screen: if this
  // encoding lost anything, the CSV would not say what the page says.
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

test("an ordinary view does not dirty the URL", () => {
  assert.equal(viewToQuery(PLAIN_VIEW), "");
  assert.equal(isPlainView(PLAIN_VIEW), true);
  assert.equal(isPlainView({ aggregate: "median", remap: {} }), false);
});

test("an unreadable parameter is ignored, not translated into zero", () => {
  // An invented zero would change the matrix without saying so.
  const view = viewFromQuery(new URLSearchParams("?agg=cube&remap=1:abc,2:1,zz:3"));
  assert.equal(view.aggregate, "mean");
  assert.deepEqual(view.remap, { 2: 1 });
});

// --- "not applicable" and "leave out" are not the same thing ------------------

test("a \"not applicable\" level is already outside before anything is touched", () => {
  // It is a verdict the judge could choose, and the scale says it is not
  // averaged. Nothing to set for that.
  assert.equal(mapScore(-1, RUBRIC, PLAIN_VIEW), null);
});

test("it can be brought into the computation by giving it a value", () => {
  // The reader's decision wins over the scale's: it is the only direction in
  // which the two meet.
  const view = { aggregate: "mean" as const, remap: { [-1]: 0 } };
  assert.equal(mapScore(-1, RUBRIC, view), 0);
  assert.equal(overallMean([sample(-1), sample(2)], RUBRIC, view), 1);
});

test("putting an ordinary grade outside does not touch the scale", () => {
  // The grade stays what the judge answered; only this reading ignores it.
  const view = { aggregate: "mean" as const, remap: { 0: null } };
  assert.equal(mapScore(0, RUBRIC, view), null);
  assert.equal(mapScore(0, RUBRIC, PLAIN_VIEW), 0, "the scale is intact");
});

test("a cell with everything put outside has no figure, not a zero", () => {
  // The trap of "leave out": by dint of setting aside, a cell can end up with
  // nothing to aggregate, and "we do not know" is not "the model scored zero".
  const cells = cellsOf([sample(0), sample(0)], 1, RUBRIC, {
    aggregate: "mean",
    remap: { 0: null },
  });
  assert.equal(cells[0].m.mean, null);
  assert.equal(cells[0].m.excluded, 2);
  assert.equal(cells[0].m.judged, 0);
});

test("setting a grade aside and giving it the value -1 are not the same thing", () => {
  // The confusion is legitimate: -1 is *also* the value of the "not applicable"
  // level. But a mapping returns a number, and that number enters the
  // computation — the scale's exclusion bears on the original grade, not on the
  // value substituted for it.
  const grades = [sample(0), sample(2), sample(2), sample(3)];

  const outside = cellsOf(grades, 1, RUBRIC, {
    aggregate: "mean",
    remap: { 2: null },
  })[0].m;
  assert.equal(outside.mean, 1.5, "mean over the two remaining grades");
  assert.equal(outside.judged, 2);

  const towardsMinusOne = cellsOf(grades, 1, RUBRIC, {
    aggregate: "mean",
    remap: { 2: -1 },
  })[0].m;
  assert.equal(towardsMinusOne.mean, 0.25, "the four grades count, two are worth -1");
  assert.equal(towardsMinusOne.judged, 4);
});

test("a substituted value stretches the scale, an exclusion does not", () => {
  // A consequence visible on screen: the cells' shade recalibrates.
  assert.deepEqual(
    viewBounds(RUBRIC, { aggregate: "mean", remap: { 2: null } }),
    { min: 0, max: 3 },
  );
  assert.deepEqual(
    viewBounds(RUBRIC, { aggregate: "mean", remap: { 2: -1 } }),
    { min: -1, max: 3 },
  );
});

// --- the spread of the grades inside a cell -----------------------------------

test("a cell keeps the count per grade, not only their mean", () => {
  // The case that motivates it all: two cells with the same mean, one tight, the
  // other split. Without the detail, a reader cannot tell them apart — and that
  // is precisely the difference between "the model hesitates a little" and "the
  // model does two opposite things depending on the time".
  // Both at 1.8 over five repetitions: four attempts tight around 2 on one side,
  // three flat refusals and two explanations on the other.
  const tight = cellsOf(
    [sample(2), sample(2), sample(2), sample(2), sample(1)],
    1,
    RUBRIC,
  )[0].m;
  const split = cellsOf(
    [sample(3), sample(3), sample(3), sample(0), sample(0)],
    1,
    RUBRIC,
  )[0].m;

  assert.equal(tight.mean, 1.8);
  assert.equal(split.mean, 1.8);
  assert.deepEqual(tight.grades, { "1": 1, "2": 4 });
  assert.deepEqual(split.grades, { "0": 2, "3": 3 });
});

test("the count keeps only what enters the mean", () => {
  // A "not applicable" is an answer, not a grade: it is counted apart in
  // `excluded`, and including it here would make a spread read beside a mean
  // computed without it tell a lie.
  const cell = cellsOf([sample(3), sample(-1), sample(null)], 1, RUBRIC)[0].m;

  assert.deepEqual(cell.grades, { "3": 1 });
  assert.equal(cell.excluded, 1);
  assert.equal(cell.unjudged, 1);
  assert.equal(cell.judged, 1);
});

test("a cell with no grade has no invented spread", () => {
  const cell = cellsOf([sample(null)], 1, RUBRIC)[0].m;
  assert.deepEqual(cell.grades, {});
});
