// Combien d'essais d'un run portent chaque palier de l'échelle — ce que le
// panneau d'extension affiche à côté de chaque note qu'on peut choisir
// d'approfondir.
//
// Compté depuis les essais que la page a déjà en mémoire, jamais depuis une
// requête à part : les tenir à jour serait le travail de la page, pas d'un
// aller-retour supplémentaire pour une question que ses données répondent
// déjà. Un palier que personne ne porte doit ressortir à zéro — sans quoi le
// cocher enverrait une demande qui n'approfondirait rien.
import type { EvalSample, RubricLevel } from "./types";

/** Combien d'essais, au total et répartis par modèle cible.
 *
 * La répartition par modèle sert le devis : `estimateDeepening` ne rend un
 * prix juste que pour un seul tarif à la fois (voir son commentaire dans
 * `pricing.ts`), et un choix d'essais à cheval sur plusieurs modèles se
 * chiffre en l'appelant une fois par modèle, avec son propre compte. */
export interface DeepenCount {
  total: number;
  byModel: Record<string, number>;
}

function emptyCount(): DeepenCount {
  return { total: 0, byModel: {} };
}

function record(count: DeepenCount, model: string): void {
  count.total += 1;
  count.byModel[model] = (count.byModel[model] ?? 0) + 1;
}

/** Un compte par palier, dans l'ordre où `rubric` les donne.
 *
 * Un essai compte pour son palier même si celui-ci est `excluded` : approfondir
 * un essai jugé « sans objet » a le même sens que pour n'importe quel autre —
 * seule la moyenne l'écarte, pas la liste des essais qu'on peut reprendre. */
export function countsByLevel(
  samples: EvalSample[],
  rubric: RubricLevel[],
): DeepenCount[] {
  return rubric.map((level) => {
    const count = emptyCount();
    for (const sample of samples) {
      if (sample.status === "done" && sample.score === level.value) {
        record(count, sample.target_model);
      }
    }
    return count;
  });
}

/** Tous les essais notés du run, quel que soit leur palier — ce que couvre
 *  `deepen: "all"`. */
export function countAllGraded(samples: EvalSample[]): DeepenCount {
  const count = emptyCount();
  for (const sample of samples) {
    if (sample.status === "done" && sample.score !== null) {
      record(count, sample.target_model);
    }
  }
  return count;
}

/** Le compte pour une sélection telle que le panneau la construit :
 *  `"all"` pour tous les essais notés, une liste de notes pour ne prendre
 *  que les essais qui les portent, `null` pour n'en approfondir aucun. */
export function countsForSelection(
  samples: EvalSample[],
  selection: "all" | number[] | null,
): DeepenCount {
  if (selection === null) return emptyCount();
  if (selection === "all") return countAllGraded(samples);
  const values = new Set(selection);
  const count = emptyCount();
  for (const sample of samples) {
    if (
      sample.status === "done" &&
      sample.score !== null &&
      values.has(sample.score)
    ) {
      record(count, sample.target_model);
    }
  }
  return count;
}
