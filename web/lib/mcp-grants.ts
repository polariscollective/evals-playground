// What is remembered of an MCP connection, and how often.
//
// Two tiny decisions, taken out of `mcp-auth.ts` because that one imports
// `server-only` and talks to the database: here, nothing but functions
// pures, donc la seule partie de cette histoire que `node --test` sache tenir.

/** Between two writes of `last_used_at`. The column serves to see what is
 *  alive, not to count calls: touching it at every request would add a round
 *  trip per tool call for a precision nobody has any use for. */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Beyond this, we truncate: a user agent is sometimes a tirade, and this
 *  colonne n'est qu'un indice sur qui appelle. */
export const MAX_CLIENT_LABEL = 200;

/** Should `last_used_at` be rewritten? Yes if it is empty — the grant has never
 *  servi — ou s'il date de plus d'un intervalle. Une valeur illisible compte
 *  as empty: one write too many beats a column frozen on a
 *  date que personne ne sait relire. */
export function needsTouch(lastUsedAt: string | null, now: Date = new Date()): boolean {
  if (!lastUsedAt) return true;
  const then = new Date(lastUsedAt).getTime();
  if (Number.isNaN(then)) return true;
  return now.getTime() - then >= TOUCH_INTERVAL_MS;
}

/** L'agent utilisateur tel qu'on le garde, ou `null` s'il n'y en a pas.
 *
 * It is not translated into a product name: guessing "claude.ai" from a string
 * not yet observed would amount to showing a certainty we do not have. Raw, it
 * at least tells the truth. */
export function clientLabelOf(userAgent: string | null | undefined): string | null {
  const trimmed = (userAgent ?? "").trim();
  return trimmed ? trimmed.slice(0, MAX_CLIENT_LABEL) : null;
}
