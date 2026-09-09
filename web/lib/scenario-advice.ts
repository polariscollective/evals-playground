// L'ancienne porte d'entrée du conseil de scénario, gardée telle quelle.
//
// Le conseil est devenu quatre documents — voir `advice.ts`, qui les tient — et
// ce fichier n'en garde que le premier, sous ses anciens noms. Il est nommé
// dans les instructions du serveur MCP, interpolé dans `agent-prompt.ts`, et
// servi par la route `/scenario-advice` : le casser casserait tous les agents
// déjà écrits, pour rien.
//
// Une seule définition du texte, dans `advice/scenario.ts`. Une copie ici
// aurait divergé — c'est exactement la raison qui l'avait fait sortir des
// profils au départ.
import { DEFAULT_ADVICE } from "./advice.ts";

/** Le conseil d'écriture de scénario. Alias du sujet `scenario` — voir
 *  `DEFAULT_ADVICE` dans `advice.ts`. */
export const DEFAULT_SCENARIO_ADVICE = DEFAULT_ADVICE.scenario;

/** Le conseil à servir : la surcharge si elle porte du texte, le défaut sinon.
 *
 * Une surcharge blanche retombe sur le défaut plutôt que de rendre une chaîne
 * vide. Vider le champ à l'écran est le geste « remets le défaut », pas
 * « n'envoie plus rien à mon agent » — et un outil MCP qui rendrait le vide
 * laisserait l'agent écrire sans le moindre garde-fou sans que personne ne
 * l'ait voulu. */
export function scenarioAdvice(override: string | null | undefined): string {
  return override && override.trim() !== "" ? override : DEFAULT_SCENARIO_ADVICE;
}
