// The sentence a database function refused with, out of PostgREST's error.
//
// `eval_runs_add_judge_notes` raises in plain English, for the person who
// asked: a name already taken, a scenario outside the run. `request`
// (`supabase.ts`) wraps that in "POST rpc/… → 409: {json}", which is no
// sentence. Pure, for `node --test`.

/** The `message` PostgREST reported for a refused request, or `null` when the
 *  error is not one (a network failure, a 5xx). */
export function databaseRefusal(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error);
  const status = /→ (\d{3}):/.exec(text)?.[1];
  if (!status || !["400", "404", "409"].includes(status)) return null;
  const body = text.slice(text.indexOf(":", text.indexOf("→")) + 1).trim();
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}
