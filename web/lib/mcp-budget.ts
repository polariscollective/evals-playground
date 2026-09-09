// Le budget qu'un appelant MCP peut lancer, en dollars.
//
// Two caps, belonging to each person rather than identical for everyone: one
// launch taken alone, and what the same caller has launched through MCP over
// the hour just gone. They live in their profile — see
// `profiles.ts` — jamais dans une variable d'environnement : deux endroits
// claiming to state the same limit would end up disagreeing. Nothing here
// talks to Supabase — that read lives in `profiles.ts`, the
// seule qui connaisse la forme de la table — si bien que tout ce fichier
// fits inside `node --test`, exactly like `mcp-grants.ts` beside
// `mcp-auth.ts`.

/** Formatted for a message read by an agent: two decimals, four when
 *  dessous du centime pour qu'un devis minuscule ne s'affiche pas « $0.00 ».
 *  Exported: it is also what `launch_draft` writes in its success response, so
 *  as not to duplicate the same rounding rule in two places. */
export function formatUsd(amount: number): string {
  return `$${amount >= 0.01 || amount === 0 ? amount.toFixed(2) : amount.toFixed(4)}`;
}

/** The decision — "does this quote pass, given what is already spent?" —
 *  separated from the profile read that feeds it. `null` if the
 *  lancement passe ; sinon le message de refus, en anglais parce que c'est un
 *  agent qui le lit, avec le chiffre en cause, le plafond, et ce que
 *  l'appelant peut en faire.
 *
 * The per-run cap is checked before the per-hour one: a quote that exceeds it
 * on its own does not need what was spent before to be known in order to be
 * refused. Both caps are those of the caller's profile — this function does not
 * know where they come from, only that they are theirs: hence "your" rather
 * than "the" in both
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
