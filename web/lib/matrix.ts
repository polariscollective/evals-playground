// La matrice d'un run, agrégée depuis ses cases.
//
// Portage de ce que faisait `backend/playground/matrix.py` : le calcul vit
// désormais côté lecture, puisque c'est l'interface qui l'affiche et l'export
// qui le recopie.
import type { Cell, EvalSample, Progress, RubricLevel } from "./types";
import { PLAIN_VIEW, aggregate, mapScore, type MatrixView } from "./view.ts";

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
  return {
    judged: 0,
    unjudged: 0,
    errored: 0,
    cancelled: 0,
    excluded: 0,
    pending: 0,
    mean: null,
    grades: {},
    cost_usd: 0,
  };
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
  rubric?: RubricLevel[],
  view: MatrixView = PLAIN_VIEW,
): Record<string, Cell>[] {
  const cells: Record<string, Cell>[] = Array.from(
    { length: scenarioCount },
    () => ({}),
  );
  // Les notes sont gardées et non additionnées au vol : une médiane ou un
  // minimum demandent de les voir toutes, ce qu'une somme courante interdit.
  const notes = new Map<string, number[]>();

  for (const sample of samples) {
    if (sample.scenario_index < 0 || sample.scenario_index >= scenarioCount) {
      continue;
    }
    const row = cells[sample.scenario_index];
    if (!row[sample.target_model]) row[sample.target_model] = emptyCell();
    const cell = row[sample.target_model];
    cell.cost_usd += sample.cost_usd ?? 0;

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
      const valeur = mapScore(sample.score, rubric, view);
      if (valeur === null) {
        // Mise dehors, soit par l'échelle — le juge a tranché « sans objet » —
        // soit par la vue. C'est une réponse, pas une absence de réponse, mais
        // elle n'entre pas dans le calcul.
        cell.excluded += 1;
      } else {
        cell.judged += 1;
        const key = `${sample.scenario_index} ${sample.target_model}`;
        notes.set(key, [...(notes.get(key) ?? []), valeur]);
      }
    }
  }

  for (const [key, values] of notes) {
    const separator = key.indexOf(" ");
    const index = Number(key.slice(0, separator));
    const target = key.slice(separator + 1);
    const cell = cells[index][target];
    cell.mean = aggregate(values, view.aggregate);
    // Les notes étaient déjà gardées entières pour la médiane ; les compter
    // ici ne coûte rien de plus et rend lisible ce qu'une moyenne cache.
    for (const value of values) {
      cell.grades[value] = (cell.grades[value] ?? 0) + 1;
    }
  }

  return cells;
}

/** Le chiffre d'un run entier, ou null si rien n'a pu être noté.
 *
 * Calculé sur les notes et non sur les chiffres des cases : agréger des agrégats
 * donnerait le même poids à une case notée dix fois et à une case notée une
 * seule. */
export function overallMean(
  samples: EvalSample[],
  rubric?: RubricLevel[],
  view: MatrixView = PLAIN_VIEW,
): number | null {
  const notes = samples
    .map((sample) =>
      sample.score === null ? null : mapScore(sample.score, rubric, view),
    )
    .filter((value): value is number => value !== null);
  return aggregate(notes, view.aggregate);
}
