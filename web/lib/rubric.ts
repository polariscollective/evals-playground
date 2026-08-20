import type { Cell, RubricLevel } from "./types";

/** La note telle qu'on l'écrit à l'écran.
 *
 * Un entier reste un entier : `2` et non `2.0`. Les échelles sont écrites à la
 * main, le plus souvent en nombres ronds, et une décimale parasite fait lire
 * une précision qui n'existe pas. Miroir de `format_value` côté serveur. */
export function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

/** Une moyenne, arrondie comme on la lit : deux décimales, sans zéros inutiles. */
export function formatMean(mean: number): string {
  return Number.isInteger(mean) ? String(mean) : mean.toFixed(2);
}

/** Les bornes de l'échelle, dans l'ordre.
 *
 * Tolère une échelle absente. Le schéma en exige deux paliers, et la migration
 * en donne une à tout run qui n'en avait pas — mais un serveur d'une version
 * antérieure, lui, renvoie des runs sans échelle du tout. Une page entière qui
 * s'effondre sur un champ manquant est un mauvais échange contre une matrice
 * hachurée, qui dit la même chose sans rien casser.
 *
 * Des bornes égales plutôt qu'un `0–1` inventé : `positionOnScale` et
 * `cellStyle` les traitent alors comme « pas d'échelle », au lieu de colorer
 * des cases selon une graduation que personne n'a écrite. */
export function rubricBounds(
  rubric: RubricLevel[] | undefined,
): { min: number; max: number } {
  // Les paliers hors moyenne sont écartés : un « sans objet » à -1 tirerait
  // sinon la borne basse vers lui, et toute la matrice changerait de couleur
  // pour un palier qui ne mesure rien.
  const comptes = (rubric ?? []).filter((level) => !level.excluded);
  if (!comptes.length) return { min: 0, max: 0 };
  const values = comptes.map((level) => level.value);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** L'échelle triée de la note la plus basse à la plus haute.
 *
 * Une échelle présentée dans le désordre se lit comme une liste d'options sans
 * progression, alors que l'ordre est précisément ce qui en fait une échelle. */
export function sortedRubric(
  rubric: RubricLevel[] | undefined,
): RubricLevel[] {
  return [...(rubric ?? [])].sort((a, b) => a.value - b.value);
}

/** Où tombe une moyenne sur l'échelle, entre 0 et 1.
 *
 * `null` quand l'échelle est dégénérée — un seul palier, que la validation
 * interdit, mais qu'un run abîmé pourrait porter. Diviser par zéro donnerait
 * une couleur arbitraire présentée comme un résultat. */
export function positionOnScale(
  mean: number,
  rubric: RubricLevel[] | undefined,
): number | null {
  const { min, max } = rubricBounds(rubric);
  if (!(max > min)) return null;
  return (mean - min) / (max - min);
}

/** Échelle de chaleur : le bas de l'échelle est clair, le haut est foncé.
 *
 * Le rouge reste réservé à l'adversaire. Une case dont rien n'a pu être noté
 * est hachurée : ce n'est pas la même chose qu'une case au plus bas, et les
 * confondre serait le pire contresens possible sur cet écran. */
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

/** La répartition des notes d'une case, pour l'infobulle.
 *
 * Une moyenne de 1,5 obtenue « toujours 1,5 » et « moitié 0, moitié 3 » ne
 * disent pas la même chose du modèle. */
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
