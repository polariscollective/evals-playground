import type { Cell, RubricLevel } from "./types";
import { viewBounds, type MatrixView } from "./view.ts";

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
 * Equal bounds rather than an invented `0–1`, so that whoever asks can tell
 * "no scale" from a real one. The heat ramp does not come through here: it
 * reads `viewBounds`, which follows the reading on screen. */
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

/** Where a value sits on the heat ramp: 0 is the red end, 1 the green end.
 *
 * `null` when there is nothing to place it against — a run with no scale, or a
 * degenerate one that validation forbids but a damaged run could carry.
 * Dividing by zero would hand back an arbitrary colour presented as a result.
 *
 * **The reading decides the bounds, never the raw scale.** A remap that folds
 * four grades onto two moves the top of the scale, and colouring against the
 * old range would leave every cell pale. `viewBounds` is what knows this.
 *
 * The deviation reading is measured on its own rule, and it has to be: its zero
 * is the good place and both ends are the bad ones, so the ramp runs on the
 * distance from the target and drops the sign. Landing three above what a
 * well-behaved model should have scored is as much of a miss as landing three
 * below, and the cell prints the signed number anyway. */
export function heatPosition(
  value: number,
  rubric: RubricLevel[] | undefined,
  view: MatrixView,
): number | null {
  if (view.relative) return 1 - Math.min(1, Math.abs(value));
  // `viewBounds` falls back on 0–1 for its own callers, which is right for a
  // sentence and wrong for a colour: it would graduate cells against a scale
  // nobody wrote.
  if (!(rubric ?? []).length) return null;
  const { min, max } = viewBounds(rubric, view);
  if (!(max > min)) return null;
  return (value - min) / (max - min);
}

/** A cell with nothing to show. Not a colour: a cell where nothing could be
 *  graded is not a cell at the bottom of the scale, and confusing the two would
 *  be the worst misreading this screen allows. */
const HATCHED =
  "bg-[repeating-linear-gradient(45deg,#e8e5d5,#e8e5d5_4px,#d3d5c2_4px,#d3d5c2_8px)] text-zinc-500";

/** The one heat ramp on this screen: rust at the bottom, olive at the top.
 *
 * One ramp for every reading, so a colour means the same thing wherever it is
 * seen. Under the plain reading the top of the scale is olive, which is why the
 * format asks for scales written with the wanted behaviour at the top; under
 * the deviation reading the target is olive and both ways off it are rust.
 *
 * The ramp is made of the framework's own colours: `--fail` at the bottom,
 * `--warn` through the middle, chartreuse and olive at the top. There is no
 * green here that is not olive and no orange that is not the permitted rust.
 *
 * Seven steps rather than a computed gradient: the classes stay readable in the
 * markup, and each step carries a text colour that holds on its own ground. */
export function heatStyle(position: number | null): string {
  if (position === null) return HATCHED;
  const t = Math.min(1, Math.max(0, position));
  if (t < 0.125) return "bg-red-600 text-red-50";
  if (t < 0.3) return "bg-red-200 text-red-950";
  if (t < 0.45) return "bg-amber-200 text-amber-950";
  if (t < 0.55) return "bg-amber-100 text-amber-950";
  if (t < 0.7) return "bg-teal-200 text-teal-950";
  if (t < 0.875) return "bg-teal-400 text-teal-950";
  return "bg-teal-700 text-teal-50";
}

/** A matrix cell's ground, under the reading currently on screen. */
export function cellStyle(
  cell: Cell | undefined,
  rubric: RubricLevel[] | undefined,
  view: MatrixView,
): string {
  if (!cell || cell.mean === null) return HATCHED;
  return heatStyle(heatPosition(cell.mean, rubric, view));
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
