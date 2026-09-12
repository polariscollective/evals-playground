// The heat ramp: which colour a cell gets, and against which scale.
//
// Worth its own file because the answer used to be wrong in a way nothing
// caught. `cellStyle` graduated every cell against the raw scale, whatever
// reading was on screen — so the deviation view, whose grades run from -1 to
// +1, was placed on a 0-3 rubric and came out uniformly at the pale end. Every
// cell looked the same, a run that had missed its target by the whole scale
// included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellStyle, formatCell, heatPosition, heatStyle } from "./rubric.ts";
import {
  PLAIN_VIEW,
  viewToQuery,
  withPercent,
  withRelative,
  withRemap,
} from "./view.ts";
import type { Cell, RubricLevel } from "./types.ts";

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "Gave in at once." },
  { value: 1, meaning: "Gave in under pressure." },
  { value: 2, meaning: "Wavered." },
  { value: 3, meaning: "Held." },
  { value: -1, meaning: "Not applicable.", excluded: true },
];

const RELATIVE = withRelative(PLAIN_VIEW, true);

function cell(mean: number | null): Cell {
  return {
    judged: 1,
    unjudged: 0,
    errored: 0,
    cancelled: 0,
    excluded: 0,
    pending: 0,
    mean,
    grades: {},
    cost_usd: 0,
    awareness_flagged: 0,
  };
}

// --- the plain reading --------------------------------------------------------

// The assertions below name the ENDS of the ramp, not the hues at them. Red at
// the bottom is the rule and is worth naming; which green sits at the top is a
// palette decision, and a test that pins it turns every retint into a failure.
const BOTTOM = heatStyle(0);
const TOP = heatStyle(1);

test("the bottom of the scale is the red end and the top the other one", () => {
  assert.equal(heatPosition(0, RUBRIC, PLAIN_VIEW), 0);
  assert.equal(heatPosition(3, RUBRIC, PLAIN_VIEW), 1);
  assert.equal(heatStyle(heatPosition(0, RUBRIC, PLAIN_VIEW)), BOTTOM);
  assert.equal(heatStyle(heatPosition(3, RUBRIC, PLAIN_VIEW)), TOP);
  assert.notEqual(TOP, BOTTOM);
});

test("a grade outside the mean does not stretch the scale", () => {
  // -1 is excluded, so the scale runs 0-3 and a 0 sits at the very bottom. Were
  // the excluded level counted, a 0 would land a quarter of the way up and the
  // whole matrix would shift colour for a grade that measures nothing.
  assert.equal(heatPosition(0, RUBRIC, PLAIN_VIEW), 0);
});

test("a remap moves the top of the scale, and the colour follows", () => {
  // 0 and 1 fold onto 0, 2 and 3 onto 1: the scale now runs 0-1, so a cell at 1
  // is at the top and must be olive. Against the raw 0-3 rubric it would have
  // come out a third of the way up.
  const folded = withRemap(PLAIN_VIEW, { 0: 0, 1: 0, 2: 1, 3: 1 });
  assert.equal(heatPosition(1, RUBRIC, folded), 1);
  assert.equal(heatStyle(heatPosition(1, RUBRIC, folded)), TOP);
});

// --- the deviation reading ----------------------------------------------------

test("on target is olive, and either way off it is rust", () => {
  assert.equal(heatPosition(0, RUBRIC, RELATIVE), 1);
  assert.equal(heatPosition(-1, RUBRIC, RELATIVE), 0);
  assert.equal(heatPosition(1, RUBRIC, RELATIVE), 0);
  assert.equal(heatStyle(heatPosition(0, RUBRIC, RELATIVE)), TOP);
  assert.equal(heatStyle(heatPosition(-1, RUBRIC, RELATIVE)), BOTTOM);
  assert.equal(heatStyle(heatPosition(1, RUBRIC, RELATIVE)), BOTTOM);
});

test("the deviation ramp ignores the run's own scale", () => {
  // The bug this file exists for. A deviation of -1 read against a 0-3 rubric
  // landed below the bottom and was clamped to the palest step, the same one a
  // deviation of 0 got.
  const onTarget = heatStyle(heatPosition(0, RUBRIC, RELATIVE));
  const asFarOffAsPossible = heatStyle(heatPosition(-1, RUBRIC, RELATIVE));
  assert.notEqual(onTarget, asFarOffAsPossible);
});

test("half a scale away is halfway along the ramp, whichever side", () => {
  assert.equal(heatPosition(0.5, RUBRIC, RELATIVE), 0.5);
  assert.equal(heatPosition(-0.5, RUBRIC, RELATIVE), 0.5);
});

// --- nothing to colour --------------------------------------------------------

test("a cell with nothing judged is hatched, not put at the bottom", () => {
  const hatched = cellStyle(cell(null), RUBRIC, PLAIN_VIEW);
  assert.match(hatched, /repeating-linear-gradient/);
  assert.notEqual(hatched, cellStyle(cell(0), RUBRIC, PLAIN_VIEW));
  assert.equal(cellStyle(undefined, RUBRIC, PLAIN_VIEW), hatched);
});

test("a run with no scale at all is hatched rather than graduated on 0-1", () => {
  assert.equal(heatPosition(1, [], PLAIN_VIEW), null);
  assert.equal(heatPosition(1, undefined, PLAIN_VIEW), null);
  assert.match(cellStyle(cell(1), [], PLAIN_VIEW), /repeating-linear-gradient/);
});

test("a scale with a single level is hatched, never divided by zero", () => {
  const single: RubricLevel[] = [{ value: 2, meaning: "The only one." }];
  assert.equal(heatPosition(2, single, PLAIN_VIEW), null);
});

// --- every step is readable ---------------------------------------------------

test("every step of the ramp carries a ground and a text colour", () => {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const style = heatStyle(t);
    assert.match(style, /\bbg-/, `no ground at ${t}`);
    assert.match(style, /\btext-/, `no text colour at ${t}`);
  }
});

test("a position outside 0-1 is clamped rather than left uncoloured", () => {
  assert.equal(heatStyle(2), heatStyle(1));
  assert.equal(heatStyle(-2), heatStyle(0));
});

// --- which end of the scale is good -------------------------------------------
//
// A judge says it (`Judge.higher_is_better`), where it used to be assumed. See
// docs/superpowers/specs/2026-09-10-which-end-of-the-scale-is-good-design.md.

test("a judge that alarms high paints its top rust and its bottom olive", () => {
  assert.equal(heatPosition(3, RUBRIC, PLAIN_VIEW, false), 0);
  assert.equal(heatPosition(0, RUBRIC, PLAIN_VIEW, false), 1);
  assert.equal(heatStyle(heatPosition(3, RUBRIC, PLAIN_VIEW, false)), BOTTOM);
  assert.equal(heatStyle(heatPosition(0, RUBRIC, PLAIN_VIEW, false)), TOP);
});

test("the direction defaults to the convention, so nothing already stored moves", () => {
  assert.equal(
    heatPosition(3, RUBRIC, PLAIN_VIEW),
    heatPosition(3, RUBRIC, PLAIN_VIEW, true),
  );
});

test("the deviation reading ignores the direction: both ends are the bad ones", () => {
  // Its zero is the target and it drops the sign, so which way the scale runs
  // changes nothing at all.
  assert.equal(
    heatPosition(0.5, RUBRIC, RELATIVE, false),
    heatPosition(0.5, RUBRIC, RELATIVE, true),
  );
});

test("a cell is coloured by the direction of the judge whose grade it shows", () => {
  const cell = { mean: 3, scores: [3], targetGap: null } as unknown as Cell;
  assert.notEqual(
    cellStyle(cell, RUBRIC, PLAIN_VIEW, true),
    cellStyle(cell, RUBRIC, PLAIN_VIEW, false),
  );
});

// --- cells as percentages -----------------------------------------------------
//
// One toggle over both readings. It changes how a number is written, never what
// was computed: 3 out of 4 and 8 out of 10 are the same result and do not look
// it until they are written the same way.

test("a percentage says how far towards the good end of the scale", () => {
  const percent = withPercent(PLAIN_VIEW, true);
  assert.equal(formatCell(3, RUBRIC, percent), "100%");
  assert.equal(formatCell(0, RUBRIC, percent), "0%");
  assert.equal(formatCell(1.5, RUBRIC, percent), "50%");
});

test("on a judge that alarms high, 100% is still the good end", () => {
  // Its best grade is its lowest. A percentage that followed the scale rather
  // than the judge would read 100% on the cell the matrix paints red.
  const percent = withPercent(PLAIN_VIEW, true);
  assert.equal(formatCell(0, RUBRIC, percent, false), "100%");
  assert.equal(formatCell(3, RUBRIC, percent, false), "0%");
});

test("under the deviation reading a percentage keeps its sign", () => {
  // A miss above and a miss below colour alike and are not the same finding.
  const percent = withPercent(RELATIVE, true);
  assert.equal(formatCell(0, RUBRIC, percent), "0%");
  assert.equal(formatCell(-0.25, RUBRIC, percent), "-25%");
  assert.equal(formatCell(0.5, RUBRIC, percent), "50%");
});

test("without the toggle a cell writes the grade it always wrote", () => {
  assert.equal(formatCell(1.5, RUBRIC, PLAIN_VIEW), "1.50");
  assert.equal(formatCell(3, RUBRIC, PLAIN_VIEW), "3");
  assert.equal(formatCell(null, RUBRIC, PLAIN_VIEW), null);
});

test("switching reading keeps the percentages somebody asked for", () => {
  assert.equal(withRelative(withPercent(PLAIN_VIEW, true), true).percent, true);
  assert.equal(withRemap(withPercent(PLAIN_VIEW, true), {}).percent, true);
});

test("the export keeps the grades: the percentage does not travel", () => {
  // A spreadsheet wants the number every other column is expressed in, and
  // `cell_meaning` could not describe a formatting it does not carry.
  assert.equal(viewToQuery(withPercent(PLAIN_VIEW, true)), "");
  assert.match(viewToQuery(withRelative(withPercent(PLAIN_VIEW, true), true)), /rel=1/);
});
