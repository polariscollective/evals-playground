/** La moyenne d'un run, tirée de l'histogramme que la vue rend.
 *
 * La vue `eval_run_list` ne calcule pas la moyenne, et c'est délibéré : une
 * note passe par `mapScore`, qui écarte les paliers marqués `excluded` dans la
 * rubrique et applique les substitutions de la vue d'affichage choisie.
 * Réécrire cette sémantique en SQL l'aurait dédoublée, et laissée diverger au
 * premier changement de l'une des deux.
 *
 * La vue rend donc `{"0": 3, "2": 5}` — combien de fois chaque note a été
 * donnée par le juge principal — et le calcul reste ici, avec le même
 * `mapScore` que la matrice. Le résultat est identique à ce que
 * `overallMean` produisait en parcourant les cases une à une : une moyenne ne
 * dépend que des valeurs et de leur nombre, pas de l'ordre où on les lit.
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
    // Postgres rend les clés d'un `jsonb_object_agg` sous la forme du type
    // d'origine — « 0.0 » pour un `double precision`. `Number` les ramène,
    // mais une clé illisible ne doit pas produire un `NaN` dans la moyenne.
    if (!Number.isFinite(score)) continue;
    const mapped = mapScore(score, rubric ?? undefined, view);
    if (mapped === null) continue;
    for (let i = 0; i < count; i += 1) values.push(mapped);
  }
  return aggregate(values, view.aggregate);
}
