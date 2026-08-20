// Quelles cases écrire en base, et avec quelle température.
//
// Séparé de `runs.ts` parce que c'est la seule partie qui mérite d'être
// éprouvée seule : le reste n'est que des écritures. C'est aussi le code qui
// portait autrefois la construction de la matrice côté Python — il a déménagé
// ici le jour où le job a cessé de la reconstruire depuis la configuration.
import { temperaturesFor } from "./temperature.ts";
import type { EvalRunConfig, EvalScenario, TemperatureSpec } from "./types";

/** Une ligne d'`eval_samples` telle qu'elle naît : en attente, sans résultat. */
export interface NewCell {
  scenario_index: number;
  scenario_title: string;
  target_model: string;
  repetition: number;
  temperature: number | null;
}

/** La clé d'un couple scénario × modèle, la colonne d'une case de matrice. */
export function coupleKey(scenarioIndex: number, target: string): string {
  return `${scenarioIndex} ${target}`;
}

/** La matrice complète d'un run neuf : un triplet scénario × modèle × répétition.
 *
 * Les températures recommencent pour chaque couple : sans ça, les scénarios
 * suivants hériteraient de températures décalées et la comparaison porterait sur
 * des réglages différents d'une ligne à l'autre. */
export function cellsForRun(config: EvalRunConfig): NewCell[] {
  const temperatures = temperaturesFor(config.temperature, config.repetitions);
  const cells: NewCell[] = [];
  for (const [index, scenario] of config.scenarios.entries()) {
    for (const target of config.models.targets) {
      for (let repetition = 0; repetition < config.repetitions; repetition += 1) {
        cells.push({
          scenario_index: index,
          scenario_title: scenario.title,
          target_model: target,
          repetition,
          temperature: temperatures[repetition],
        });
      }
    }
  }
  return cells;
}

/** Les cases à ajouter à un run existant.
 *
 * Les répétitions continuent la numérotation de leur couple plutôt que de
 * repartir de zéro : c'est ce qui distingue « ajouter trois essais » de
 * « refaire les trois premiers », et ce qui empêche la contrainte d'unicité de
 * refuser l'insertion. Un couple encore jamais couvert — un scénario neuf, un
 * modèle neuf — commence bien à zéro.
 *
 * @param scenarios La liste complète, anciens et nouveaux à la suite.
 * @param lastRepetition La dernière répétition de chaque couple déjà en base. */
export function cellsForExtension(
  scenarios: EvalScenario[],
  indices: number[],
  targets: string[],
  repetitions: number,
  temperature: TemperatureSpec | null | undefined,
  lastRepetition: Map<string, number>,
): NewCell[] {
  // L'étalement porte sur les répétitions *ajoutées*, pas sur le total : les
  // anciennes gardent la température qu'elles ont eue, inscrite sur leur ligne.
  const temperatures = temperaturesFor(temperature, repetitions);
  const cells: NewCell[] = [];
  for (const index of indices) {
    const scenario = scenarios[index];
    if (!scenario) continue;
    for (const target of targets) {
      const start = (lastRepetition.get(coupleKey(index, target)) ?? -1) + 1;
      for (let offset = 0; offset < repetitions; offset += 1) {
        cells.push({
          scenario_index: index,
          scenario_title: scenario.title,
          target_model: target,
          repetition: start + offset,
          temperature: temperatures[offset],
        });
      }
    }
  }
  return cells;
}
