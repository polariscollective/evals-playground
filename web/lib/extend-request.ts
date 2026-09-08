// La demande d'extension telle que le panneau la compose — extraite de sa
// fermeture React (`ExtendPanel.buildRequest`) pour qu'elle se teste sans
// monter de composant, comme `extend-estimate.ts`, `deepen-counts.ts` et
// `measured-length.ts` avant elle.
//
// `needsWorldModel` répond à deux questions qui doivent rester une seule :
// l'écran s'en sert pour montrer le champ « World model » et bloquer la
// confirmation tant qu'il est vide ; la demande s'en sert pour décider si elle
// porte `world`. Elles s'accordaient par construction jusqu'à un correctif qui
// a niché la seconde sous `newTools.length > 0` (CRITICAL 2) — un run
// antérieur à `models.world` peut déjà servir sans le nommer (voir
// `extendProblem`, A1), et pour lui l'écran montrait le champ, en exigeait le
// remplissage, puis l'omettait de la demande : le serveur refusait alors avec
// le message même qui avait envoyé l'utilisateur ici. Une seule fonction
// tranche désormais, et `buildExtendRequest` comme le panneau l'appellent
// tous les deux — voir `components/ExtendPanel.tsx`.
import { servesTools } from "./tools.ts";
import type { EvalRunConfig, EvalScenario, ExtendRequest, ToolSpec } from "./types";

/** Ce run a-t-il besoin qu'on lui nomme un modèle de monde, une fois cette
 *  extension prise en compte ?
 *
 * Vrai seulement quand le run n'en a pas encore un et que l'union de ce qu'il
 * sert déjà et de ce que `newTools` ajoute sert quelque chose — pas seulement
 * `newTools` : un run lancé avant l'existence de `models.world` peut déjà
 * servir sans le nommer, et c'est justement le cas que ce module ferme (voir
 * le commentaire de tête). Un run qui sert déjà impose silencieusement son
 * modèle (`extendRun`) ; lui en envoyer un autre serait refusé pour rien,
 * donc jamais vrai dans ce cas. */
export function needsWorldModel(
  config: Pick<EvalRunConfig, "tools" | "models">,
  newTools: ToolSpec[],
): boolean {
  const hasWorldModel = Boolean(config.models.world?.trim());
  return !hasWorldModel && servesTools([...(config.tools ?? []), ...newTools]);
}

/** Ce que le panneau a réuni dans son état, avant que `buildExtendRequest`
 *  n'en fasse une demande — un champ par état React, tel qu'`ExtendPanel` les
 *  tient. */
export interface ExtendPanelValues {
  /** Les scénarios déjà présents à re-couvrir, par leur index. */
  indices: number[];
  /** Les scénarios neufs — à la main et du CSV, déjà fusionnés par le
   *  panneau. */
  newScenarios: EvalScenario[];
  targets: string[];
  repetitions: number;
  /** Les deux bornes du champ de température, telles que la frappe les
   *  laisse : chaîne vide pour « rien saisi ». */
  tempMin: string;
  tempMax: string;
  /** Les outils que cette extension ajoute au décor du run. */
  newTools: ToolSpec[];
  /** Les scénarios existants sans outils nommés héritent-ils des nouveaux ?
   *  `null` tant que la question n'a pas été répondue. */
  forExisting: boolean | null;
  /** Ce que le champ « World model » porte, tel quel — vide tant que rien n'a
   *  été choisi. */
  worldModel: string;
  /** La profondeur voulue. */
  turns: number;
  deepen: "all" | number[] | null;
}

/** La demande d'extension telle qu'elle est là — utilisée pour confirmer et
 *  pour enregistrer un brouillon, seule différence entre les deux usages du
 *  panneau.
 *
 * `new_tools_for_existing` n'est écrit que si la question a été répondue :
 * l'absence de clé et `true` se lisent pareil pour le serveur (voir
 * `extendProblem`), donc rien ne change pour la confirmation, où le bouton
 * garantit déjà une réponse — mais un brouillon peut la laisser en suspens, et
 * il faut alors que la relire retrouve « pas encore répondu » plutôt qu'un
 * `true` que personne n'a choisi.
 *
 * `world` suit `needsWorldModel(config, newTools)`, jamais
 * `newTools.length > 0` : voir le commentaire de tête pour ce que la
 * différence a coûté. */
export function buildExtendRequest(
  config: Pick<EvalRunConfig, "tools" | "models" | "turns">,
  values: ExtendPanelValues,
): ExtendRequest {
  const {
    indices,
    newScenarios,
    targets,
    repetitions,
    tempMin,
    tempMax,
    newTools,
    forExisting,
    worldModel,
    turns,
    deepen,
  } = values;
  const min = tempMin.trim() === "" ? null : Number(tempMin);
  return {
    scenario_indices: indices,
    new_scenarios: newScenarios,
    targets,
    repetitions,
    temperature:
      min === null
        ? null
        : { min, max: tempMax.trim() === "" ? null : Number(tempMax) },
    ...(newTools.length > 0
      ? {
          new_tools: newTools,
          ...(forExisting !== null ? { new_tools_for_existing: forExisting } : {}),
        }
      : {}),
    ...(needsWorldModel(config, newTools) ? { world: worldModel } : {}),
    // Absent laisse la profondeur telle quelle : envoyer la valeur de départ
    // quand rien n'a changé n'apprendrait rien au serveur qu'il ne sache déjà.
    ...(turns !== config.turns ? { turns } : {}),
    ...(deepen !== null ? { deepen } : {}),
  };
}
