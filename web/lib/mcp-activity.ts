// What an agent's sliding hour says, in one sentence — for the profile page.
// The authoritative count lives in `mcp_launches`, read by
// `mcpActivityLastHour` in `runs.ts`; this function does nothing but say it,
// without touching Supabase, like `mcp-budget.ts` beside it.
import { amountDigits } from "./pricing.ts";

/** How many launches an agent triggered for this person over the hour just
 *  gone, and for what amount, in one sentence.
 *
 * Zero launches is the common case: say so calmly rather than show an empty
 * table, which would leave it to be guessed whether the page loaded the right
 * thing or nobody ever launched anything. `amountDigits` stops a tiny quote —
 * an extension of a tenth of a cent, quite real — showing
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
