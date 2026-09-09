// The models a person wants offered, and nothing else.
//
// The catalogue holds forty-one models; a menu of forty-one entries is worse
// than nine. Everyone therefore chooses what they see of it, and this list
// decides everything that OFFERS — the screens, the agent's prompt, the MCP
// tools.
//
// What it never decides: what EXISTS. `knownModelIds()` alone answers that
// question, and it is what `configProblem` consults. A run already launched
// therefore shows with its models whatever happens to the favourites, and a
// human relaunch stays launchable.
//
// With no Supabase and no session: the same rule serves the form, which refuses
// before sending, and the route, which refuses even if the form was bypassed.
import { knownModelIds } from "./catalog.ts";

/** The model a blank run page opens on.
 *
 * Named, and not derived from the first of the list: while it was derived, a
 * reordering of the catalogue moved the default without anyone asking — the
 * widening to forty-one models thus moved the opening from Opus 5 to Fable 5.1,
 * and silently doubled a blank page's quote. A name resists order.
 *
 * Sonnet 5: the latest Sonnet, and the cheapest of the catalogue's three. It
 * ignores temperature, like every Claude 4.7 and above — so a blank page shows
 * the warning. That is true, and saying so is better than choosing an older
 * model to avoid it. */
export const DEFAULT_RUN_MODEL = "anthropic/claude-sonnet-5";

/** What is offered to whoever has chosen nothing.
 *
 * The nine models the product offered when the catalogue was written by hand,
 * plus Fable 5.1. Lives in the code and not in the database: a `profiles` row
 * that copied this list would never again receive what gets added to it — see
 * the migration `profiles_favorite_models`, which carries the same reasoning as
 * `scenario_advice` before it. */
export const DEFAULT_FAVORITE_MODELS: readonly string[] = [
  "anthropic/claude-fable-5-1",
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
  "grok/grok-4.6",
  "grok/grok-4.5",
  "grok/grok-4.3",
];

/** The models to offer this person.
 *
 * `null` — an absent profile as much as an empty column — returns the default.
 * Not knowing who is looking is no reason to offer nothing: a public route such
 * as `/format.txt` comes through here with no profile and must serve something.
 *
 * Identifiers no longer in the catalogue are set aside on reading rather than on
 * writing: the list is written at one moment, the catalogue moves without it, and
 * a menu must not carry an entry whose only effect would be to fail at the first
 * billed call. If the filtering leaves nothing, we fall back on the default — an
 * empty menu would make the application unusable with no way of guessing why. */
export function favoriteModels(
  profile: { favorite_models: string[] | null } | null,
): string[] {
  const written = profile?.favorite_models;
  if (!written) return [...DEFAULT_FAVORITE_MODELS];
  const known = knownModelIds();
  const alive = written.filter((id) => known.has(id));
  return alive.length > 0 ? alive : [...DEFAULT_FAVORITE_MODELS];
}

/** `null` if `value` can become a list of favourites, otherwise what is wrong.
 *
 * The empty array is refused here rather than in the database: the constraint is
 * stated better in a sentence than in SQL, and it is that sentence the form
 * shows. Without a single favourite, every menu in the application would be
 * empty.
 *
 * A duplicate is refused rather than silently deduplicated: it comes from a
 * client that got it wrong, and fixing it without saying so hides the error. */
export function favoritesProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    return "favorite_models must be an array of model identifiers";
  }
  const ids = value as string[];
  if (ids.length === 0) {
    return "keep at least one model: with none, every model menu in the app would be empty";
  }
  if (new Set(ids).size !== ids.length) {
    return "favorite_models lists the same model twice";
  }
  const known = knownModelIds();
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return `not models this tool can run: ${unknown.join(", ")}`;
  }
  return null;
}

/** The refusal of a model that exists but which this person has not chosen, or
 *  `null`.
 *
 * Says nothing about an identifier outside the catalogue: `configProblem` has
 * already refused it with its own message, and answering "add it to your
 * favourites" would send one to fix a profile that can never hold it. The two
 * refusals are distinct because the two gestures of repair are.
 *
 * An empty string passes: several model fields are optional, and an absent
 * field is not a refused model. */
export function notFavouriteProblem(
  id: string,
  favorites: readonly string[],
  where: string,
): string | null {
  if (!id.trim()) return null;
  if (favorites.includes(id)) return null;
  if (!knownModelIds().has(id)) return null;
  return (
    `${where}: "${id}" exists, but it is not in your favourite models — it may have been ` +
    "before. Add it back in your profile to use it."
  );
}
