// A person's profile: their two spending caps per agent, their own rather than
// everyone's — see the `profiles` migration in `polaris-supabase` for why that
// choice, and its accepted price (no global circuit breaker any more).
//
// A single function, `ensureProfile`, called by the two doors that establish an
// authenticated identity — `requireUser` on the web side, `callerEmail` on the
// MCP side — so that the profile exists before anyone even needs it: an agent
// that has never opened the screen must not discover the profile's absence at
// the moment it tries to spend.
import "server-only";
import { DEFAULT_ADVICE, type AdviceTopic } from "./advice";
import { PROFILES, SupabaseError, insert, select, update } from "./supabase";
import type { Profile } from "./types";

/** The profile of `email`, created at the table's defaults if it did not exist
 *  yet.
 *
 * Reads first rather than inserting blind: past the first time, the common case
 * costs only one read. The primary key is the address, so two requests creating
 * the same profile at the same time can collide — one of the two insertions
 * then fails on a violated constraint. That is not an error to report: the
 * profile exists, which is all that matters, so we read again rather than
 * propagating the write's failure.
 *
 * Raises only if the profile can really neither be read nor created — the
 * caller then makes a refusal to spend out of it, never a cap guessed on the
 * person's behalf. */
export async function ensureProfile(email: string): Promise<Profile> {
  const found = await select<Profile>(PROFILES, {
    user_email: `eq.${email}`,
    select: "*",
    limit: 1,
  });
  if (found[0]) return found[0];

  try {
    const created = await insert<Profile>(PROFILES, { user_email: email }, { returning: true });
    if (created[0]) return created[0];
  } catch (error) {
      // A race lost against another request: the address was taken between our
      // read and our write. Not an error — the row exists, it is enough to read
      // it again below. Any other error (connection, permissions) will turn up
      // in the reread that follows anyway: if the profile is not there either,
      // it ends up raising.
    if (!(error instanceof SupabaseError)) throw error;
  }

  const after = await select<Profile>(PROFILES, {
    user_email: `eq.${email}`,
    select: "*",
    limit: 1,
  });
  if (after[0]) return after[0];
  throw new SupabaseError(`Could not create or read a profile for ${email}.`);
}

/** Changes the two caps of `email`, from the profile screen — the only write
 *  on this table outside its creation.
 *
 * Validates nothing: `capProblem`, in `profile-caps.ts`, already did so before
 * reaching here, on the route side as much as the form side. Reads back
 * afterwards rather than returning what was just written: `ensureProfile` is
 * the only function that still knows how to make the row exist if, through an
 * unlikely race, it had vanished in the meantime. */
export async function updateProfileCaps(
  email: string,
  caps: { max_usd_per_run: number; max_usd_per_hour: number },
): Promise<Profile> {
  await update(PROFILES, caps, { user_email: `eq.${email}` });
  return ensureProfile(email);
}

/** Writes — or erases — the override of the scenario writing advice.
 *
 * `null` restores the default. A blank string, or a trimmed one equal to the
 * default, is brought back to `null` before writing: storing blank, or a copy
 * of the default, would make an override that exists without saying anything —
 * indistinguishable on reading from a real text for `scenarioAdvice`, but
 * silently depriving that person of the default's future improvements. The
 * trimming serves only that comparison: a genuinely different text keeps its
 * internal whitespace, written as it stands.
 *
 * This net exists on top of the `/scenarios` page's own: the route can be
 * called without going through it.
 *
 * Reads back afterwards for the same reason as `updateProfileCaps`:
 * `ensureProfile` is the only function that knows how to make the row exist
 * again. */
export async function updateScenarioAdvice(
  email: string,
  advice: string | null,
): Promise<Profile> {
  return updateAdvice(email, "scenario", advice);
}

/** Writes the override of ONE advice document, from the page that edits them.
 *
 * Writing exactly the default is worth putting it back to `null`: the intended
 * gesture is "I have nothing of my own here", and copying the default into the
 * row would deprive this person of every later improvement without their having
 * asked. A blank string does the same, and that is the "put the default back"
 * gesture on screen.
 *
 * The `scenario` topic writes BOTH columns: the new one, and the older
 * `scenario_advice`, so that a deployment rolled back does not lose the text.
 * That is the only reason to keep the old one up to date; `overridesOf`
 * (`advice.ts`) always reads it second. */
export async function updateAdvice(
  email: string,
  topic: AdviceTopic,
  advice: string | null,
): Promise<Profile> {
  const profile = await ensureProfile(email);
  const trimmed = advice?.trim() ?? "";
  const own =
    trimmed !== "" && trimmed !== DEFAULT_ADVICE[topic].trim() ? advice : null;

  const overrides: Record<string, string> = { ...(profile.advice_overrides ?? {}) };
  if (own === null) delete overrides[topic];
  else overrides[topic] = own;

  const patch: Record<string, unknown> = {
    // An empty object rather than `null` would be an override that overrides
    // nothing: `overridesOf` would read it the same, but `null` says what we
    // mean.
    advice_overrides: Object.keys(overrides).length > 0 ? overrides : null,
  };
  if (topic === "scenario") patch.scenario_advice = own;

  await update(PROFILES, patch, { user_email: `eq.${email}` });
  return ensureProfile(email);
}

/** Writes the favourites of `email`, from the profile screen.
 *
 * Validates nothing: `favoritesProblem`, in `favorite-models.ts`, already did
 * so before reaching here, on the route side as much as the form side.
 *
 * Never writes `null`: restoring the default is done by ticking what one wants,
 * not by emptying the list — and an empty list is refused upstream. The column
 * only becomes `null` again if nobody has ever touched it.
 *
 * Reads back afterwards for the same reason as `updateProfileCaps`:
 * `ensureProfile` is the only function that knows how to make the row exist
 * again. */
export async function updateFavoriteModels(
  email: string,
  models: string[],
): Promise<Profile> {
  await update(PROFILES, { favorite_models: models }, { user_email: `eq.${email}` });
  return ensureProfile(email);
}
