import type { Cell, RubricLevel } from "./types";

/** The grade as it is written on screen.
 *
 * A whole number stays a whole number: `2`, not `2.0`. Scales are written by
 * hand, most often in round numbers, and a stray decimal reads as a precision
 * that does not exist. Mirror of `format_value` on the server side. */
export function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

/** A mean, rounded as it is read: two decimals, with no useless zeros. */
export function formatMean(mean: number): string {
  return Number.isInteger(mean) ? String(mean) : mean.toFixed(2);
}

/** The scale's bounds, in order.
 *
 * Tolerates a missing scale. The schema demands two levels, and the migration
 * gives one to any run that had none — but a server from an earlier version
 * returns runs with no scale at all. A whole page collapsing on a missing field
 * is a bad trade against a hatched matrix, which says the same thing without
 * breaking anything.
 *
 * Equal bounds rather than an invented `0–1`: `positionOnScale` and `cellStyle`
 * then treat them as "no scale", instead of colouring cells by a graduation
 * nobody wrote. */
export function rubricBounds(
  rubric: RubricLevel[] | undefined,
): { min: number; max: number } {
  // The levels outside the mean are set aside: a "not applicable" at -1 would
  // otherwise pull the lower bound towards it, and the whole matrix would change
  // colour for a grade that measures nothing.
  const counted = (rubric ?? []).filter((level) => !level.excluded);
  if (!counted.length) return { min: 0, max: 0 };
  const values = counted.map((level) => level.value);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** The scale sorted from lowest grade to highest.
 *
 * A scale presented out of order reads as a list of options with no
 * progression, when the order is precisely what makes it a scale. */
export function sortedRubric(
  rubric: RubricLevel[] | undefined,
): RubricLevel[] {
  return [...(rubric ?? [])].sort((a, b) => a.value - b.value);
}

/** Where a mean falls on the scale, between 0 and 1.
 *
 * `null` when the scale is degenerate — a single level, which validation
 * forbids, but which a damaged run could carry. Dividing by zero would give an
 * arbitrary colour presented as a result. */
export function positionOnScale(
  mean: number,
  rubric: RubricLevel[] | undefined,
): number | null {
  const { min, max } = rubricBounds(rubric);
  if (!(max > min)) return null;
  return (mean - min) / (max - min);
}

/** A heat scale: the bottom of the scale is light, the top is dark.
 *
 * Red stays reserved for the adversary. A cell where nothing could be graded is
 * hatched: that is not the same as a cell at the bottom, and confusing the two
 * would be the worst possible misreading on this screen. */
export function cellStyle(
  cell: Cell | undefined,
  rubric: RubricLevel[] | undefined,
): string {
  const hachures =
    "bg-[repeating-linear-gradient(45deg,#f4f4f5,#f4f4f5_4px,#e4e4e7_4px,#e4e4e7_8px)] text-zinc-400";
  if (!cell || cell.mean === null) return hachures;
  const t = positionOnScale(cell.mean, rubric);
  if (t === null) return hachures;
  if (t <= 0) return "bg-teal-50 text-teal-900";
  if (t < 0.25) return "bg-amber-100 text-amber-900";
  if (t < 0.5) return "bg-amber-200 text-amber-950";
  if (t < 0.75) return "bg-amber-400 text-amber-950";
  return "bg-amber-700 text-amber-50";
}

/** The distribution of a cell's grades, for the tooltip.
 *
 * A mean of 1.5 obtained as "always 1.5" and as "half 0, half 3" do not say the
 * same thing about the model. */
export function distribution(scores: (number | null)[]): string {
  const counts = new Map<number, number>();
  let unjudged = 0;
  for (const score of scores) {
    if (score === null) unjudged += 1;
    else counts.set(score, (counts.get(score) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([value, n]) => `${n}× ${formatValue(value)}`);
  if (unjudged > 0) parts.push(`${unjudged} not judged`);
  return parts.join(" · ");
}
