// Comment une case de la matrice se calcule, du côté de celui qui regarde.
//
// Rien de tout ceci ne touche la base : les notes du juge restent ce qu'elles
// sont, et c'est leur lecture qu'on change. Un run ne se rejoue pas pour poser
// une autre question à ses résultats.
//
// Deux réglages seulement, parce qu'ils composent :
//
//   - une **table de correspondance**, qui remplace chaque note par une autre,
//     ou la met hors du calcul ;
//   - une **fonction d'agrégation**, qui réduit les notes d'une case à un nombre.
//
// « 0 et 1 valent 0, 2 et 3 valent 1, puis moyenne » n'est pas un mode à part :
// c'est une correspondance suivie d'une moyenne, et le résultat est la
// proportion de conversations arrivées au niveau 2. C'est aussi pourquoi il n'y
// a pas de mode « taux au-dessus d'un seuil » : il existe déjà.
//
// Pas de code arbitraire, volontairement. Une expression ne se met pas dans
// l'en-tête d'un CSV, et un nombre qu'on ne peut pas expliquer à qui reçoit le
// fichier ne vaut pas mieux qu'un nombre faux. Ces deux réglages-là s'écrivent
// en une phrase — `describeView` le fait.
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
  /** Note d'origine → note de remplacement, ou `null` pour la mettre dehors. */
  remap: Record<number, number | null>;
}

export const PLAIN_VIEW: MatrixView = { aggregate: "mean", remap: {} };

export function isPlainView(view: MatrixView): boolean {
  return view.aggregate === "mean" && Object.keys(view.remap).length === 0;
}

/** Ce que devient une note, ou `null` si elle sort du calcul.
 *
 * L'échelle du run tranche en dernier : un palier « sans objet » reste dehors
 * tant qu'une correspondance ne le rappelle pas explicitement. */
export function mapScore(
  score: number,
  rubric: RubricLevel[] | undefined,
  view: MatrixView,
): number | null {
  if (score in view.remap) return view.remap[score];
  const level = (rubric ?? []).find((entry) => entry.value === score);
  return level?.excluded ? null : score;
}

/** Les notes d'une case, réduites à un nombre. */
export function aggregate(values: number[], how: Aggregate): number | null {
  if (values.length === 0) return null;
  if (how === "min") return Math.min(...values);
  if (how === "max") return Math.max(...values);
  if (how === "mean") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  // Un nombre pair de notes n'a pas de milieu : la moyenne des deux valeurs
  // centrales est la convention, et elle garde la médiane dans l'échelle.
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Les bornes de l'échelle telle qu'on la regarde.
 *
 * Sans elles, une correspondance qui ramène l'échelle à 0–1 laisserait la
 * couleur des cases calée sur l'ancienne étendue : tout paraîtrait pâle. */
export function viewBounds(
  rubric: RubricLevel[] | undefined,
  view: MatrixView,
): { min: number; max: number } {
  const values = (rubric ?? [])
    .map((level) => mapScore(level.value, rubric, view))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return { min: 0, max: 1 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** La vue en une phrase, pour l'écran et pour l'en-tête d'un export.
 *
 * Un nombre qui n'est plus la moyenne des notes doit dire ce qu'il est, surtout
 * une fois recopié dans un tableur où plus rien ne le rappelle. */
export function describeView(
  view: MatrixView,
  rubric: RubricLevel[] | undefined,
): string {
  const how =
    AGGREGATES.find((entry) => entry.id === view.aggregate)?.sentence ??
    "the mean of its grades";
  const changed = (rubric ?? [])
    .filter((level) => level.value in view.remap)
    .map((level) => {
      const to = view.remap[level.value];
      return to === null ? `${level.value} ignored` : `${level.value}→${to}`;
    });
  return changed.length === 0 ? how : `${how}, with ${changed.join(", ")}`;
}

// --- le passage par une URL ---------------------------------------------------
//
// L'export est produit par le serveur, qui ne voit pas l'écran : la vue voyage
// donc dans la requête. Le même encodage rendrait une vue partageable par
// simple lien, si on en vient là.

export function viewToQuery(view: MatrixView): string {
  const params = new URLSearchParams();
  if (view.aggregate !== "mean") params.set("agg", view.aggregate);
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

  const remap: Record<number, number | null> = {};
  for (const pair of (params.get("remap") ?? "").split(",")) {
    if (!pair) continue;
    const [from, to] = pair.split(":");
    const score = Number(from);
    if (!Number.isFinite(score)) continue;
    // Une valeur illisible est ignorée plutôt que traduite en zéro : un zéro
    // inventé changerait la matrice sans le dire.
    if (to === "x") remap[score] = null;
    else if (Number.isFinite(Number(to))) remap[score] = Number(to);
  }
  return { aggregate, remap };
}
