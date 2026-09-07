// Ce qui mérite d'être dit sans être refusé.
//
// Servir un outil depuis un monde vide est presque toujours une faute : le
// modèle improvise, et improviser est exactement ce que l'outil servi existe
// pour éviter. Presque — un outil purement calculatoire, dont les
// `retrieval_rules` suffisent à tout produire, n'a aucun monde à lire.
// Refuser interdirait cet usage-là pour attraper la faute probable ; on
// nomme la faute et on laisse passer.
//
// Hors de `validate.ts`, délibérément : ces fonctions-là ne rendent que des
// refus. Un refus arrête, un avertissement informe, et les mélanger ferait
// qu'un jour l'un se comporterait comme l'autre.
import { servesTools, toolsFor } from "./tools.ts";
import type { EvalRunConfig, EvalScenario, ExtendRequest } from "./types";

function isFilled(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** Un scénario par avertissement, pour chaque scénario servi sans aucun monde
 *  à lire.
 *
 * Le monde qu'une case lit est `run.world + scenario.world` — voir
 * `EvalScenario.world` — donc la question ne se pose jamais si le run en
 * porte un : tout est couvert d'office, quel que soit ce qu'un scénario y
 * ajoute. Sinon elle se pose par scénario, et seulement pour celui à qui
 * `toolsFor` offre au moins un outil servi : un scénario sans outil servi n'a
 * rien à lire nulle part, et l'avertir serait du bruit — la raison même pour
 * laquelle un avertissement cesse d'être lu. */
export function worldWarnings(config: EvalRunConfig): string[] {
  if (isFilled(config.world)) return [];

  const warnings: string[] = [];
  for (const scenario of config.scenarios) {
    if (isFilled(scenario.world)) continue;
    if (!servesTools(toolsFor(config, scenario))) continue;
    warnings.push(
      `\`${scenario.title}\`: served from an empty world — neither the run ` +
        "nor this scenario describes anything to read, so the model will " +
        "improvise. That is what a served tool exists to avoid.",
    );
  }
  return warnings;
}

/** Le même risque, à l'extension — et un second qui s'y ajoute, plus dur à
 *  réparer : le monde d'un run est gelé au lancement (voir
 *  `EvalRunConfig.world`), et rien dans une extension ne peut lui en donner un
 *  après coup.
 *
 * `new_tools_for_existing` fait hériter des outils neufs les scénarios déjà
 * joués qui n'en nommaient aucun — voir sa docstring dans `types.ts`. Si l'un
 * d'eux reçoit ainsi un outil servi alors que le run ne porte aucun monde, il
 * ne pourra jamais en lire un : une case déjà jouée n'a pas de champ où en
 * écrire un, contrairement à un scénario neuf, qui porte le sien. Un seul
 * texte suffit pour tous les scénarios concernés — ce n'est réparable pour
 * aucun d'eux, les nommer un par un n'ajouterait rien. */
export function extendWorldWarnings(
  request: Pick<ExtendRequest, "new_tools" | "new_tools_for_existing">,
  runConfig: Pick<EvalRunConfig, "world"> & {
    scenarios: Pick<EvalScenario, "title" | "tools">[];
  },
): string[] {
  const ajoutés = request.new_tools ?? [];
  if (!servesTools(ajoutés)) return [];
  // `false` gèle explicitement la liste des scénarios déjà joués sur les
  // outils qu'ils avaient : personne n'hérite, donc rien à avertir.
  if (request.new_tools_for_existing === false) return [];
  if (isFilled(runConfig.world)) return [];

  // Seul un scénario qui n'avait nommé aucun outil peut hériter des nouveaux :
  // `extendProblem` interdit de redéfinir un nom déjà pris, donc un scénario
  // qui liste les siens explicitement ne peut pas se retrouver, par
  // coïncidence, à nommer un outil qui vient de naître.
  const affecte = runConfig.scenarios.some(
    (scenario) => toolsFor({ tools: ajoutés }, scenario).length > 0,
  );
  if (!affecte) return [];

  return [
    "This extension serves tools on scenarios the run has already played, " +
      "and the run's world is empty. A run's world is frozen at launch, so " +
      "those scenarios cannot be given one — only new scenarios can carry " +
      "their own.",
  ];
}
