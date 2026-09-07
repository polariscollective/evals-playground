// Quels outils un scénario reçoit réellement.
//
// Séparé parce que trois endroits en ont besoin — le devis, la validation et
// l'écran — et qu'une règle à trois états recopiée trois fois finit par ne plus
// dire la même chose partout.
import type { EvalRunConfig, EvalScenario, ToolSpec } from "./types";

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
  return Boolean(tool.retrieval_rules?.trim());
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
