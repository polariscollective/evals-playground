// How a cell of the matrix is computed, from the point of view of whoever is
// looking.
//
// None of this touches the database: the judge's grades stay what they are, and
// it is how they are read that changes. A run is not replayed to ask its
// results a different question.
//
// Two settings only, because they compose:
//
//   - a **mapping table**, which replaces each grade with another, or puts it
//     outside the computation;
//   - an **aggregate function**, which reduces a cell's grades to one number.
//
// "0 and 1 count as 0, 2 and 3 count as 1, then a mean" is not a mode of its
// own: it is a mapping followed by a mean, and the result is the proportion of
// conversations that reached level 2. That is also why there is no "rate above
// a threshold" mode: it exists already.
//
// No arbitrary code, deliberately. An expression does not go into a CSV header,
// and a number that cannot be explained to whoever receives the file is no
// better than a wrong number. These two settings are written in one sentence —
// `describeView` does it.
import type { RubricLevel } from "./types";

export type Aggregate = "mean" | "median" | "min" | "max";

export const AGGREGATES: { id: Aggregate; label: string; sentence: string }[] = [
  { id: "mean", label: "Mean", sentence: "the mean of its grades" },
  { id: "median", label: "Median", sentence: "the median of its grades" },
  { id: "min", label: "Worst", sentence: "the lowest grade it got" },
  { id: "max", label: "Best", sentence: "the highest grade it got" },
];

export interface MatrixView {
  aggregate: Aggregate;
  /** Original grade → replacement grade, or `null` to put it outside. */
  remap: Record<number, number | null>;
  /** Read every cell as a distance from what a good model should have scored,
   *  rather than as a grade — see `deviation` in `targets.ts`.
   *
   * **Exclusive with `remap`**, and `withRelative`/`withRemap` below are the
   * only two places that set either, so the exclusion does not have to be
   * remembered by every caller. A folded scale no longer matches the one the
   * targets were written against: the distance would be measured from a target
   * that has moved. */
  relative?: boolean;
  /** Show each cell as a percentage rather than as a number on the scale.
   *
   * Composes with everything: under the plain reading it is how far the cell
   * got towards the good end of its scale, under the deviation reading it is
   * how far off the target it landed, as a share of the widest miss the scale
   * allows. Either way a cell becomes comparable with a cell of another judge,
   * which two scales of different lengths otherwise are not.
   *
   * **A display, and nothing else.** It changes no computation: the same
   * number is written differently, which is why it does not travel with the
   * view into an export — see `viewToQuery`. */
  percent?: boolean;
}

export const PLAIN_VIEW: MatrixView = { aggregate: "mean", remap: {} };

export function isPlainView(view: MatrixView): boolean {
  return (
    view.aggregate === "mean" &&
    Object.keys(view.remap).length === 0 &&
    !view.relative &&
    !view.percent
  );
}

/** Switches the deviation reading on or off, dropping the remap if there was
 *  one. The two cannot coexist — see `MatrixView.relative`. */
export function withRelative(view: MatrixView, relative: boolean): MatrixView {
  // The percentage survives both ways: it is how the number is written, not
  // what is computed, and somebody who asked for percentages does not want them
  // taken away by switching reading.
  return relative
    ? { aggregate: view.aggregate, remap: {}, relative: true, percent: view.percent }
    : { aggregate: view.aggregate, remap: {}, percent: view.percent };
}

/** Switches the percentage display on or off, leaving the reading alone. */
export function withPercent(view: MatrixView, percent: boolean): MatrixView {
  return { ...view, percent };
}

/** Sets a remap, turning the deviation reading off if it was on. Symmetric
 *  with `withRelative`. */
export function withRemap(
  view: MatrixView,
  remap: Record<number, number | null>,
): MatrixView {
  return { aggregate: view.aggregate, remap, percent: view.percent };
}

/** What a grade becomes, or `null` if it leaves the computation.
 *
 * The run's scale decides last: a "not applicable" level stays outside as long
 * as a mapping does not explicitly call it back. */
export function mapScore(
  score: number,
  rubric: RubricLevel[] | undefined,
  view: MatrixView,
): number | null {
  if (score in view.remap) return view.remap[score];
  const level = (rubric ?? []).find((entry) => entry.value === score);
  return level?.excluded ? null : score;
}

/** A cell's grades, reduced to one number. */
export function aggregate(values: number[], how: Aggregate): number | null {
  if (values.length === 0) return null;
  if (how === "min") return Math.min(...values);
  if (how === "max") return Math.max(...values);
  if (how === "mean") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // An even number of grades has no middle: the mean of the two central values
  // is the convention, and it keeps the median inside the scale.
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The bounds of the scale as it is being looked at.
 *
 * Without them, a mapping that brings the scale back to 0–1 would leave the
 * cells' colour calibrated on the old range: everything would look pale. */
export function viewBounds(
  rubric: RubricLevel[] | undefined,
  view: MatrixView,
): { min: number; max: number } {
  // The deviation reading has bounds of its own, the same for every row
  // whatever their scales — that is the whole point of the normalisation. See
  // `deviation`, `targets.ts`.
  if (view.relative) return { min: -1, max: 1 };
  const values = (rubric ?? [])
    .map((level) => mapScore(level.value, rubric, view))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** The view in one sentence, for the screen and for an export's header.
 *
 * A number that is no longer the mean of the grades must say what it is,
 * especially once copied into a spreadsheet where nothing recalls it. */
export function describeView(
  view: MatrixView,
  rubric: RubricLevel[] | undefined,
): string {
  const how =
    AGGREGATES.find((entry) => entry.id === view.aggregate)?.sentence ??
    "the mean of its grades";
  if (view.relative) {
    // Never combined with a remap: `withRelative` forbids it. The sentence
    // therefore does not have to describe both.
    const measure = how.replace("its grades", "how far its grades landed from " +
      "what a well-behaved model should have scored");
    return measure;
  }
  const changed = (rubric ?? [])
    .filter((level) => level.value in view.remap)
    .map((level) => {
      const to = view.remap[level.value];
      return to === null ? `${level.value} ignored` : `${level.value}→${to}`;
    });
  return changed.length === 0 ? how : `${how}, with ${changed.join(", ")}`;
}

// --- the trip through a URL ---------------------------------------------------
//
// The export is produced by the server, which does not see the screen: the view
// therefore travels in the request. The same encoding would make a view
// shareable by a plain link, if it ever comes to that.

export function viewToQuery(view: MatrixView): string {
  const params = new URLSearchParams();
  // `percent` is deliberately absent. The export writes numbers for a
  // spreadsheet, where a percentage is one formula away and a raw grade is what
  // every other column is expressed in; and `cell_meaning`, which describes the
  // view, would have to describe a formatting it cannot show.
  if (view.aggregate !== "mean") params.set("agg", view.aggregate);
  if (view.relative) params.set("rel", "1");
  const pairs = Object.entries(view.remap).map(
    ([from, to]) => `${from}:${to === null ? "x" : to}`,
  );
  if (pairs.length > 0) params.set("remap", pairs.join(","));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function viewFromQuery(params: URLSearchParams): MatrixView {
  const asked = params.get("agg") ?? "mean";
  const aggregate = AGGREGATES.some((entry) => entry.id === asked)
    ? (asked as Aggregate)
    : "mean";

  // The deviation wins if both are there: an address hand-tinkered with must
  // not produce a view `withRelative` would never have let exist.
  if (params.get("rel") === "1") return { aggregate, remap: {}, relative: true };

  const remap: Record<number, number | null> = {};
  for (const pair of (params.get("remap") ?? "").split(",")) {
    if (!pair) continue;
    const [from, to] = pair.split(":");
    const score = Number(from);
    if (!Number.isFinite(score)) continue;
    // An unreadable value is ignored rather than translated into zero: an
    // invented zero would change the matrix without saying so.
    if (to === "x") remap[score] = null;
    else if (Number.isFinite(Number(to))) remap[score] = Number(to);
  }
  return { aggregate, remap };
}
