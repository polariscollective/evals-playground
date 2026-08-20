// La matrice d'un run, agrégée depuis ses cases.
//
// Portage de ce que faisait `backend/playground/matrix.py` : le calcul vit
// désormais côté lecture, puisque c'est l'interface qui l'affiche et l'export
// qui le recopie.
import type { Cell, EvalSample, Progress } from "./types";

/** Où en est un run, compté sur ses cases plutôt que sur un compteur à part.
 *
 * `total` vient du nombre de lignes, toutes créées au lancement : la
 * progression est donc exacte avant même que le job ne démarre. */
export function progressOf(samples: EvalSample[]): Progress {
  const progress: Progress = {
    total: samples.length,
    done: 0,
    running: 0,
    pending: 0,
    errored: 0,
    cancelled: 0,
  };
  for (const sample of samples) {
    if (sample.status === "done") progress.done += 1;
    else if (sample.status === "running") progress.running += 1;
    else if (sample.status === "error") progress.errored += 1;
    else if (sample.status === "cancelled") progress.cancelled += 1;
    else progress.pending += 1;
  }
  return progress;
}

function emptyCell(): Cell {
  return { judged: 0, unjudged: 0, errored: 0, cancelled: 0, pending: 0, mean: null };
}

/** La matrice, une entrée par scénario.
 *
 * La liste garde toujours `scenarioCount` entrées, même vides : elle est
 * alignée sur `config.scenarios`, et une ligne manquante décalerait toute la
 * lecture.
 *
 * Une case sans note est comptée à part plutôt qu'ignorée — et une case en
 * panne encore à part. La moyenne ne dit rien de ce qu'elle n'a pas pu
 * mesurer, et « le modèle a obtenu zéro » n'est pas « on ne sait pas ». */
export function cellsOf(
  samples: EvalSample[],
  scenarioCount: number,
): Record<string, Cell>[] {
  const cells: Record<string, Cell>[] = Array.from(
    { length: scenarioCount },
    () => ({}),
  );
  const totals = new Map<string, number>();

  for (const sample of samples) {
    if (sample.scenario_index < 0 || sample.scenario_index >= scenarioCount) {
      continue;
    }
    const row = cells[sample.scenario_index];
    if (!row[sample.target_model]) row[sample.target_model] = emptyCell();
    const cell = row[sample.target_model];

    if (sample.status === "pending" || sample.status === "running") {
      cell.pending += 1;
    } else if (sample.status === "cancelled") {
      // Jamais commencée. Pas une panne : on a décidé de ne pas la faire.
      cell.cancelled += 1;
    } else if (sample.status === "error") {
      cell.errored += 1;
    } else if (sample.score === null) {
      cell.unjudged += 1;
    } else {
      cell.judged += 1;
      const key = `${sample.scenario_index} ${sample.target_model}`;
      totals.set(key, (totals.get(key) ?? 0) + sample.score);
    }
  }

  for (const [key, total] of totals) {
    const separator = key.indexOf(" ");
    const index = Number(key.slice(0, separator));
    const target = key.slice(separator + 1);
    const cell = cells[index][target];
    cell.mean = total / cell.judged;
  }

  return cells;
}

/** Moyenne d'un run entier, ou null si rien n'a pu être noté.
 *
 * Calculée sur les notes et non sur les moyennes des cases : une moyenne de
 * moyennes donnerait le même poids à une case notée dix fois et à une case
 * notée une seule. */
export function overallMean(samples: EvalSample[]): number | null {
  const notes = samples
    .map((sample) => sample.score)
    .filter((score): score is number => score !== null);
  if (notes.length === 0) return null;
  return notes.reduce((sum, note) => sum + note, 0) / notes.length;
}
