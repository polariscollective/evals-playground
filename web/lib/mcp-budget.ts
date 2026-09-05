// Le budget qu'un appelant MCP peut lancer, en dollars.
//
// Deux plafonds, propres à chaque personne plutôt qu'identiques pour tout le
// monde : un lancement pris seul, et ce qu'un même appelant a lancé par MCP
// sur l'heure qui vient de s'écouler. Ils vivent dans son profil — voir
// `profiles.ts` — jamais dans une variable d'environnement : deux endroits
// qui prétendent dire la même limite finiraient par ne plus être d'accord.
// Rien ici ne parle à Supabase — cette lecture vit dans `profiles.ts`, la
// seule qui connaisse la forme de la table — si bien que tout ce fichier
// tient dans `node --test`, exactement comme `mcp-grants.ts` à côté de
// `mcp-auth.ts`.

/** Formaté pour un message lu par un agent : deux décimales, quatre en
 *  dessous du centime pour qu'un devis minuscule ne s'affiche pas « $0.00 ».
 *  Exporté : c'est aussi ce que `launch_draft` écrit dans sa réponse de
 *  succès, pour ne pas dupliquer la même règle d'arrondi à deux endroits. */
export function formatUsd(amount: number): string {
  return `$${amount >= 0.01 || amount === 0 ? amount.toFixed(2) : amount.toFixed(4)}`;
}

/** La décision — « ce devis passe-t-il, compte tenu de ce qui est déjà
 *  dépensé ? » — séparée de la lecture du profil qui la nourrit. `null` si le
 *  lancement passe ; sinon le message de refus, en anglais parce que c'est un
 *  agent qui le lit, avec le chiffre en cause, le plafond, et ce que
 *  l'appelant peut en faire.
 *
 * Le plafond par run est vérifié avant celui par heure : un devis qui le
 * dépasse déjà à lui seul n'a pas besoin qu'on sache ce qui a été dépensé
 * avant pour être refusé. Les deux plafonds sont ceux du profil de
 * l'appelant — cette fonction ne sait pas d'où ils viennent, seulement
 * qu'ils sont les siens : d'où « your » plutôt que « the » dans les deux
 * messages. */
export function budgetProblem(
  quoteUsd: number,
  spentLastHourUsd: number,
  maxPerRunUsd: number,
  maxPerHourUsd: number,
): string | null {
  if (quoteUsd > maxPerRunUsd) {
    return (
      `This draft is quoted at ${formatUsd(quoteUsd)}, above your ${formatUsd(maxPerRunUsd)} per-run ` +
      "cap on agent-launched runs. That cap does not apply to a human launching the same draft from " +
      "the web app: ask one to launch it, or trim the draft's scope — fewer scenarios, models, or " +
      "repetitions — with update_draft_run and try again."
    );
  }

  const projected = spentLastHourUsd + quoteUsd;
  if (projected > maxPerHourUsd) {
    return (
      `You have spent ${formatUsd(spentLastHourUsd)} launching runs by MCP in the last hour; ` +
      `adding this ${formatUsd(quoteUsd)} draft would bring that to ${formatUsd(projected)}, above ` +
      `your ${formatUsd(maxPerHourUsd)} hourly cap. That cap does not apply to a human launching from ` +
      "the web app: ask one to launch it, or wait for older runs to age out of the hour before " +
      "trying again."
    );
  }

  return null;
}
