// Ce qu'un scénario porte en plus des trois champs obligatoires.
//
// Séparé du rendu parce que c'est la seule partie qui tient une règle, et la
// seule que le dépôt sache tester — `node --test` ne regarde que `lib/`.
import type { EvalScenario } from "./types";

/** Les étiquettes d'un scénario, dans l'ordre où on les lit.
 *
 * Un scénario sans rien n'en produit aucune, et c'est le cas courant : une
 * pastille sur chaque ligne d'un lot n'apprendrait rien. Ce qui mérite d'être
 * vu est l'écart au défaut.
 *
 * D'où le silence sur `tools` absent, qui veut dire « tous les outils du run ».
 * `tools: none` en produit une, parce que c'est un choix — et que confondre les
 * deux ferait disparaître de l'écran la comparaison « la même ligne, avec et
 * sans outils », qui est souvent la mesure qu'on cherche. */
export function scenarioBadges(scenario: EvalScenario): string[] {
  const badges: string[] = [];

  if (scenario.note?.trim()) badges.push("note");

  const turns = scenario.history?.length ?? 0;
  if (turns > 0) badges.push(`${turns} seeded turn${turns > 1 ? "s" : ""}`);

  // `!= null` et non la vérité de la valeur : une liste vide est fausse pour
  // personne en JavaScript, mais c'est précisément l'état qu'on veut nommer.
  if (scenario.tools != null) {
    badges.push(
      scenario.tools.length === 0
        ? "no tools"
        : `${scenario.tools.length} tool${scenario.tools.length > 1 ? "s" : ""}`,
    );
  }

  return badges;
}
