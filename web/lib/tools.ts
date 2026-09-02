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
