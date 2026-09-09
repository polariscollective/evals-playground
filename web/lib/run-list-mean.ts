/** A run's mean, drawn from the histogram the view returns.
 *
 * The `eval_run_list` view does not compute the mean, and that is deliberate: a
 * grade goes through `mapScore`, which sets aside the levels marked `excluded`
 * in the
 * rubrique et applique les substitutions de la vue d'affichage choisie.
 * Rewriting that semantics in SQL would have duplicated it, and let it diverge
 * at the
 * premier changement de l'une des deux.
 *
 * The view therefore returns `{"0": 3, "2": 5}` — how many times each grade was
 * given by the principal judge — and the computation stays here, with the same
 * `mapScore` as the matrix. The result is identical to what `overallMean`
 * produced by walking the cells one by one: a mean depends only on the values
 * and their number, not on the order they are read in.
 */
import { PLAIN_VIEW, aggregate, mapScore, type MatrixView } from "./view.ts";
import type { RubricLevel } from "./types.ts";

export function meanFromHistogram(
  histogram: Record<string, number> | null,
  rubric: RubricLevel[] | null,
  view: MatrixView = PLAIN_VIEW,
): number | null {
  if (!histogram) return null;

  const values: number[] = [];
  for (const [raw, count] of Object.entries(histogram)) {
    const score = Number(raw);
    // Postgres returns the keys of a `jsonb_object_agg` in the original type's
    // form — "0.0" for a `double precision`. `Number` brings them back, but an
    // unreadable key must not produce a `NaN` in the mean.
    if (!Number.isFinite(score)) continue;
    const mapped = mapScore(score, rubric ?? undefined, view);
    if (mapped === null) continue;
    for (let i = 0; i < count; i += 1) values.push(mapped);
  }
  return aggregate(values, view.aggregate);
}
