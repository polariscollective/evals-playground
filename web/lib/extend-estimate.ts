// Le devis d'une extension : un seul calcul, appelé des deux côtés.
//
// Le panneau annonce un prix avant qu'on confirme ; `extendRun` enregistre
// celui de la même extension juste après. C'étaient deux calculs distincts, et
// deux calculs de la même chose finissent toujours par ne plus dire pareil :
// le panneau ne passait aucune longueur et retombait sur le nombre déclaré là
// où le serveur pesait ce que le run avait réellement dépensé — jusqu'à un
// facteur trois sur un approfondissement, sous une phrase qui promettait
// pourtant « priced on what this run actually spent ».
//
// Il n'y a donc plus qu'une fonction, et les deux appelants l'appellent. Elle
// ne touche ni la base ni le réseau : chacun lui apporte ce qu'il sait déjà,
// la page ses cases en mémoire et `extendRun` celles qu'il vient de lire.
import { addEstimates, estimateCost } from "./pricing.ts";
import { estimateDeepeningCost } from "./deepen-counts.ts";
import { answerLengthsFor } from "./measured-length.ts";
import type { DeepenCell } from "./deepen-counts";
import type { MeasuredLengths } from "./measured-length";
import type {
  CostEstimate,
  EvalRunConfig,
  EvalScenario,
  ToolSpec,
} from "./types";

/** Un scénario que l'extension va faire jouer, et l'index qu'il porte — ou
 *  portera — dans le run.
 *
 * L'index n'est pas décoratif : c'est lui qui dit ce que le run a déjà mesuré
 * de ce scénario-là. Un scénario neuf n'a pas d'index déjà joué et hérite donc
 * de la moyenne du run, ce qui est exactement la cascade d'`answerLengthsFor`.
 * Les porter par paires interdit le décalage qui donnerait à un scénario la
 * longueur d'un autre. */
export interface AddedScenario {
  index: number;
  scenario: EvalScenario;
}

/** Ce qu'une extension ajoute, réduit à ce qui fixe son prix. */
export interface Extension {
  /** Les scénarios à jouer, existants comme neufs, dans l'ordre. */
  scenarios: AddedScenario[];
  /** Les modèles cibles des cases neuves. */
  targets: string[];
  /** Combien d'essais par case neuve. */
  repetitions: number;
  /** La profondeur demandée : celle des cases neuves, et celle jusqu'où les
   *  essais à continuer sont poussés. */
  turns: number;
  /** Les outils du run **après** l'extension. */
  tools: ToolSpec[];
  /** Les essais à continuer, réduits au modèle qui les joue et à la profondeur
   *  d'où ils repartent. */
  deepen: DeepenCell[];
}

/** Ce que cette extension va coûter, mesure comprise.
 *
 * `null` quand elle n'ajoute rien et n'approfondit rien — il n'y a alors pas de
 * prix à afficher, et rien à ajouter au devis enregistré du run.
 *
 * Les longueurs viennent de `measured`, jamais de la constante générale : un
 * scénario rejoué prend sa propre mesure, un scénario neuf celle du run, et
 * l'adversaire la sienne. La déclaration de la config ne sert que de dernier
 * recours, à travers `answerLengthsFor` et `resolve`. */
export function estimateExtension(
  config: EvalRunConfig,
  extension: Extension,
  measured: MeasuredLengths,
): CostEstimate | null {
  const { scenarios, targets, repetitions, turns, tools, deepen } = extension;

  // Les cases neuves, à la profondeur demandée : c'est à celle-là qu'elles
  // tourneront, la configuration l'ayant reçue avant qu'elles ne naissent.
  const ajout =
    scenarios.length > 0 && targets.length > 0
      ? estimateCost(
          {
            ...config,
            tools,
            turns,
            scenarios: scenarios.map((entry) => entry.scenario),
            models: { ...config.models, targets },
            repetitions,
          },
          {
            answer: answerLengthsFor(
              scenarios.map((entry) => entry.index),
              measured,
              config.average_output_tokens,
            ),
            adversary: measured.adversary,
          },
        )
      : null;

  // L'approfondissement, groupé par couple (modèle cible, profondeur de
  // départ) — voir `estimateDeepeningCost`. Une longueur unique pour les
  // réponses et non une par scénario : les groupes ne sont pas des scénarios,
  // et un groupe en recouvre plusieurs à la fois. L'adversaire garde la
  // sienne, comme pour les cases neuves ; les deux retombent sur la
  // déclaration du run quand rien n'a pu être mesuré. Rien tant que la
  // profondeur demandée ne dépasse pas celle du run : `extendProblem` refuse
  // d'ailleurs d'approfondir sans elle.
  const approfondi =
    deepen.length > 0 && turns > config.turns
      ? estimateDeepeningCost(config, deepen, turns, config.turns, {
          answer: measured.run,
          adversary: measured.adversary,
        })
      : null;

  if (!ajout) return approfondi;
  return approfondi ? addEstimates(ajout, approfondi) : ajout;
}
