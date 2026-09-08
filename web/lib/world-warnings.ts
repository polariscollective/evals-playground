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
import { servesTools, toolsFor, writesWorld } from "./tools.ts";
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

/** Un scénario qui écrit dans un monde que rien ne lit.
 *
 * `world_effect` n'a qu'un lecteur : le modèle d'environnement, quand il sert
 * un appel qui vient après. Un scénario dont aucun outil ne porte de
 * `retrieval_rules` journalise donc dans le vide — les entrées s'écrivent,
 * elles ne sont jamais relues, et l'expérimentateur croit avoir posé un monde
 * qui bouge alors qu'il a posé une phrase morte.
 *
 * Nommé plutôt que refusé, comme le monde vide au-dessus : la combinaison
 * reste licite — on peut vouloir déclarer l'effet d'avance, avant d'ajouter
 * l'outil qui le lira par extension — et refuser interdirait cet ordre-là
 * pour attraper la faute probable.
 *
 * Un avertissement par scénario concerné, par son titre : contrairement au
 * monde gelé d'une extension, celui-ci se répare scénario par scénario. */
export function writeWithoutReadWarnings(config: EvalRunConfig): string[] {
  const warnings: string[] = [];
  for (const scenario of config.scenarios) {
    const offerts = toolsFor(config, scenario);
    if (!offerts.some(writesWorld)) continue;
    if (servesTools(offerts)) continue;
    warnings.push(
      `\`${scenario.title}\`: a tool here declares a world_effect, but no tool ` +
        "in this scenario reads the world. The effect would be recorded and " +
        "never read — nothing would ever notice the change.",
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
 * d'eux reçoit ainsi un outil servi alors que ni le run ni lui ne portent de
 * monde, il ne pourra jamais en lire un : le monde du run est gelé, et une
 * extension ne réécrit pas le monde d'un scénario déjà joué.
 *
 * **Un scénario qui porte déjà le sien n'est donc pas concerné** : il a de
 * quoi lire, et rien ne lui manque. L'avertir serait un faux positif, et un
 * avertissement qui crie pour rien cesse d'être lu — c'est la seule façon de
 * le rendre inutile.
 *
 * Un seul texte suffit pour tous les scénarios réellement concernés : ce n'est
 * réparable pour aucun d'eux, les nommer un par un n'ajouterait rien. */
export function extendWorldWarnings(
  request: Pick<ExtendRequest, "new_tools" | "new_tools_for_existing">,
  runConfig: Pick<EvalRunConfig, "world"> & {
    scenarios: Pick<EvalScenario, "title" | "tools" | "world">[];
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
    (scenario) =>
      !isFilled(scenario.world) &&
      toolsFor({ tools: ajoutés }, scenario).length > 0,
  );
  if (!affecte) return [];

  return [
    "This extension serves tools on scenarios the run has already played, " +
      "and the run's world is empty. A run's world is frozen at launch, so " +
      "those scenarios cannot be given one — only new scenarios can carry " +
      "their own.",
  ];
}
