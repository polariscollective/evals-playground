// Ce que dit l'heure glissante d'un agent, en une phrase — pour la page de
// profil. Le compte qui fait foi vit dans `mcp_launches`, lu par
// `mcpActivityLastHour` dans `runs.ts` ; cette fonction ne fait que le dire,
// sans toucher Supabase, comme `mcp-budget.ts` à côté.
import { amountDigits } from "./pricing.ts";

/** Combien de lancements un agent a déclenchés pour cette personne sur
 *  l'heure qui vient de s'écouler, et pour quel montant, en une phrase.
 *
 * Zéro lancement est le cas courant : le dire calmement plutôt que d'afficher
 * un tableau vide, qui laisserait deviner si la page a chargé la bonne chose
 * ou si personne n'a jamais rien lancé. `amountDigits` évite qu'un devis
 * minuscule — une extension d'un dixième de cent, bien réelle — s'affiche
 * `$0.00`. */
export function activitySentence(count: number, usd: number): string {
  if (count === 0) {
    return "No run or extension launched by an agent in the last hour.";
  }
  const plural = count === 1 ? "launch" : "launches";
  return (
    `${count} agent-triggered ${plural} in the last hour, ` +
    `totalling $${amountDigits(usd)}.`
  );
}
