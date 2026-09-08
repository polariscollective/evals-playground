// Quels outils un scénario reçoit réellement.
//
// Séparé parce que trois endroits en ont besoin — le devis, la validation et
// l'écran — et qu'une règle à trois états recopiée trois fois finit par ne plus
// dire la même chose partout.
import type { EvalRunConfig, EvalScenario, ExtendRequest, ToolSpec } from "./types";

/** Une chaîne qui porte autre chose que des blancs.
 *
 * Répétée dans plusieurs fichiers (`validate.ts`, `world-warnings.ts`) plutôt
 * que partagée : celui-ci ne peut pas importer de `validate.ts`, qui importe
 * déjà `servesTools` d'ici — un cycle. */
function isFilled(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Les outils offerts à un scénario.
 *
 * Trois états, et ils comptent : la clé absente offre tout le décor du run, une
 * liste offre ce qu'elle nomme, une liste vide n'offre rien. Sans le troisième,
 * on ne pourrait pas comparer une ligne avec outils à la même ligne sans, qui
 * est souvent la mesure qu'on cherche.
 *
 * Un nom qui ne désigne aucun outil est ignoré : la validation le refuse en
 * amont, et rien ici ne doit tomber sur une configuration déjà acceptée. */
export function toolsFor(
  config: Pick<EvalRunConfig, "tools">,
  scenario: Pick<EvalScenario, "tools">,
): ToolSpec[] {
  const tools = config.tools ?? [];
  if (scenario.tools == null) return tools;
  const wanted = new Set(scenario.tools);
  return tools.filter((tool) => wanted.has(tool.name));
}

/** Cet outil passe-t-il par le modèle d'environnement ?
 *
 * Jumeau de `ToolSpec.served` côté Python, et pour la même raison : le
 * discriminant vit à un endroit, sans quoi on l'oublie au troisième site
 * d'appel. Détouré parce qu'un champ à moitié effacé dans un formulaire ne
 * doit pas faire basculer un outil en servi — donc payant. */
export function served(tool: Pick<ToolSpec, "retrieval_rules">): boolean {
  return isFilled(tool.retrieval_rules);
}

/** Cet outil rend-il un résultat fixe, écrit d'avance ?
 *
 * L'autre moitié de l'exclusion que `served` nomme déjà (IMPORTANT 3) : sans
 * elle, `!tool.result.trim()` ailleurs (`ToolsEditor.tsx`) n'était pas
 * null-safe comme son jumeau, et `toolsProblem` n'exige jamais `result` — un
 * outil servi qu'une requête directe (hors composeur) prive de `result`
 * atteindrait cette lecture et romprait le rendu au lieu de simplement
 * cacher le mauvais champ. Les deux moitiés d'une exclusion doivent lire leur
 * champ de la même façon, sans quoi il existe un état où ni l'une ni l'autre
 * ne s'affiche — ou, ici, où l'une fait tomber l'écran. */
export function fixed(tool: Pick<ToolSpec, "result">): boolean {
  return isFilled(tool.result);
}

/** Ce run sert-il au moins un outil ?
 *
 * La question que posent les deux refus de `models.world` : requis dès qu'un
 * outil sert, interdit sinon. */
export function servesTools(
  tools: readonly Pick<ToolSpec, "retrieval_rules">[],
): boolean {
  return tools.some(served);
}

/** Le modèle qui sert — ou servira — les outils de ce run, une fois cette
 *  extension prise en compte.
 *
 * Celui du run gagne toujours : `extendProblem` refuse qu'une extension en
 * change un qui existe déjà, donc `config.models.world` prime. Ce n'est que
 * quand le run n'en a encore aucun — parce qu'il ne sert rien, ou parce qu'il
 * est antérieur à ce champ — que celui nommé par la demande compte, et lui
 * seul comble le vide.
 *
 * Trois appelants posaient chacun `config.models.world || request.world ||
 * null` de son côté : `extendRun` en écrivant la configuration, le devis d'une
 * extension en la chiffrant, l'écran en l'affichant. Une seule copie, pour ne
 * pas laisser l'une des trois répondre autrement le jour où la règle change.
 *
 * `isFilled`, pas `||` brut (MINOR) : un `models.world` à une seule espace
 * est storable sur un run qui ne sert rien — rien ici ne l'empêche, et
 * `configProblem` ne s'applique jamais à une extension — et `||` le rendrait
 * quand même, truthy qu'il est. Le devis chiffrerait alors la part servie sur
 * ce modèle-là, qu'aucun tarif ne connaît : non pas gratuit, mais compté pour
 * zéro sans que rien ne le dise. */
export function resolvedWorld(
  config: Pick<EvalRunConfig, "models">,
  request: Pick<ExtendRequest, "world">,
): string | null {
  if (isFilled(config.models.world)) return config.models.world as string;
  if (isFilled(request.world)) return request.world as string;
  return null;
}
