// Validates a spending cap as it is typed into the profile form, before the
// route writes it into `profiles` — see
// `updateProfileCaps` dans `profiles.ts`.
//
// With no Supabase and no session: the same rule serves the form, which
// refuses before sending, and the route, which refuses even if the form was
// bypassed.

/** Beyond this it is a typo, not an intention.
 *
 * A run of this product costs cents to a few dollars; the defaults are 2 and
 * 10. A bound at a hundred therefore leaves every room for real use while
 * stopping the figure typed with one zero too many — and a spending cap a slip
 * of the keyboard can lift protects nothing. */
const CAP_MAX = 100;

/** `null` si `value` peut devenir un plafond, sinon ce qui cloche.
 *
 * Zero is allowed, and is in fact the only emergency brake left: at zero, any
 * strictly positive quote is refused, so this person's agents spend nothing any
 * more. It is the gesture one wants to be able to make quickly.
 *
 * A negative makes no sense: no quote is below it, so it would read as zero
 * while looking as though it said something else.
 *
 * `NaN` is what a field emptied while typing returns; the screen uses it to
 * disable "Save" without having to write a second rule. */
export function capProblem(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "must be zero or a positive number";
  }
  if (value > CAP_MAX) {
    return `must be at most ${CAP_MAX} — a higher cap is more likely a typo than an intent`;
  }
  return null;
}

/** `null` if the body of a PATCH `/api/profile` can be handled, otherwise what
 *  qui cloche.
 *
 * The route applies either the caps, or the scenario-writing advice, or the
 * favourite models — never two at once. Choosing which of the settings carried
 * by one body to overwrite would be arbitrary for whoever sent it. It validates
 * only that mutual exclusion: the shape of each field (a cap through
 * `capProblem`, a string or `null` for the advice, an array through
 * `favoritesProblem` for the favourites) remains the
 * charge de la route, qui seule sait quoi faire du corps une fois admis. */
export function profilePatchProblem(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as {
    scenario_advice?: unknown;
    favorite_models?: unknown;
    max_usd_per_run?: unknown;
    max_usd_per_hour?: unknown;
  };
  // Three independent settings, one route: each arrives from its own screen and
  // none has to know the others. A body carrying two is refused rather than
  // silently clearing one of them.
  const sent = [
    b.scenario_advice !== undefined,
    b.favorite_models !== undefined,
    b.max_usd_per_run !== undefined || b.max_usd_per_hour !== undefined,
  ].filter(Boolean).length;
  if (sent > 1) {
    return "Send the spending caps, the scenario advice and the favourite models in separate requests — this route applies one of the three, and silently dropping the rest of what you sent would be worse than refusing it.";
  }
  return null;
}
