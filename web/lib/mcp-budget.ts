// Le budget qu'un appelant MCP peut lancer, en dollars.
//
// Deux plafonds, réglables sans toucher au dépôt : `MCP_MAX_USD_PER_RUN` borne
// un lancement pris seul, `MCP_MAX_USD_PER_HOUR` borne ce qu'un même appelant a
// lancé par MCP sur l'heure qui vient de s'écouler. Rien ici ne parle à
// Supabase — cette lecture vit dans `runs.ts`, la seule qui connaisse la forme
// des deux tables — si bien que tout ce fichier tient dans `node --test`,
// exactement comme `mcp-grants.ts` à côté de `mcp-auth.ts`.

/** `MCP_MAX_USD_PER_RUN`, ou le défaut si absente, invalide, ou négative. */
export function maxUsdPerRun(): number {
  const raw = Number(process.env.MCP_MAX_USD_PER_RUN);
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

/** `MCP_MAX_USD_PER_HOUR`, ou le défaut si absente, invalide, ou négative. */
export function maxUsdPerHour(): number {
  const raw = Number(process.env.MCP_MAX_USD_PER_HOUR);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

/** Formaté pour un message lu par un agent : deux décimales, quatre en
 *  dessous du centime pour qu'un devis minuscule ne s'affiche pas « $0.00 ».
 *  Exporté : c'est aussi ce que `launch_draft` écrit dans sa réponse de
 *  succès, pour ne pas dupliquer la même règle d'arrondi à deux endroits. */
export function formatUsd(amount: number): string {
  return `$${amount >= 0.01 || amount === 0 ? amount.toFixed(2) : amount.toFixed(4)}`;
}

/** La décision — « ce devis passe-t-il, compte tenu de ce qui est déjà
 *  dépensé ? » — séparée de la lecture en base qui la nourrit. `null` si le
 *  lancement passe ; sinon le message de refus, en anglais parce que c'est un
 *  agent qui le lit, avec le chiffre en cause, le plafond, et ce que
 *  l'appelant peut en faire.
 *
 * Le plafond par run est vérifié avant celui par heure : un devis qui le
 * dépasse déjà à lui seul n'a pas besoin qu'on sache ce qui a été dépensé
 * avant pour être refusé. */
export function budgetProblem(
  quoteUsd: number,
  spentLastHourUsd: number,
  maxPerRunUsd: number,
  maxPerHourUsd: number,
): string | null {
  if (quoteUsd > maxPerRunUsd) {
    return (
      `This draft is quoted at ${formatUsd(quoteUsd)}, above the ${formatUsd(maxPerRunUsd)} per-run cap ` +
      "on agent-launched runs (MCP_MAX_USD_PER_RUN). That cap does not apply to a human " +
      "launching the same draft from the web app: ask one to launch it, or trim the draft's " +
      "scope — fewer scenarios, models, or repetitions — with update_draft_run and try again."
    );
  }

  const projected = spentLastHourUsd + quoteUsd;
  if (projected > maxPerHourUsd) {
    return (
      `You have spent ${formatUsd(spentLastHourUsd)} launching runs by MCP in the last hour; ` +
      `adding this ${formatUsd(quoteUsd)} draft would bring that to ${formatUsd(projected)}, above the ` +
      `${formatUsd(maxPerHourUsd)} hourly cap (MCP_MAX_USD_PER_HOUR). That cap does not apply to a ` +
      "human launching from the web app: ask one to launch it, or wait for older runs to age " +
      "out of the hour before trying again."
    );
  }

  return null;
}
