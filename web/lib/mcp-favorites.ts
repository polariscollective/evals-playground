// The refusal of a model outside the favourites — and this is the only place.
//
// `configProblem` goes on validating against the WHOLE catalogue, and that is
// deliberate: a run already launched must show with its models, and a
// pre-filled relaunch must stay launchable by hand. It is the agent that is
// bounded, not the person.
//
// Hence this module of its own rather than a branch in `validate.ts`: the day
// somebody adds a caller to `configProblem`, it will not inherit a refusal that
// only makes sense through MCP.
import { notFavouriteProblem } from "./favorite-models.ts";
import type { EvalRunConfig, ExtendRequest } from "./types";

/** The first model outside the favourites in a list, put into words, or
 *  `null`.
 *
 * The first and not all: the message says what to do, and an enumeration of
 * five refusals helps no more than one in finding your profile again. */
function firstProblem(
  entries: { id: string | null | undefined; where: string }[],
  favorites: readonly string[],
): string | null {
  for (const entry of entries) {
    const problem = notFavouriteProblem(entry.id ?? "", favorites, entry.where);
    if (problem) return problem;
  }
  return null;
}

/** What, among a run's models, is not in the favourites of
 *  l'appelant — ou `null`. */
export function configFavouritesProblem(
  config: EvalRunConfig,
  favorites: readonly string[],
): string | null {
  return firstProblem(
    [
      ...config.models.targets.map((id, index) => ({
        id,
        where: `models.targets[${index}]`,
      })),
      { id: config.models.adversary, where: "models.adversary" },
      { id: config.models.judge, where: "models.judge" },
      { id: config.models.world, where: "models.world" },
      ...(config.judges ?? []).map((judge, index) => ({
        id: judge.model,
        where: `judges[${index}].model`,
      })),
    ],
    favorites,
  );
}

/** What, among the models an extension adds, is not in the
 *  favoris de l'appelant — ou `null`.
 *
 * Looks only at what the extension ADDS. The run's already-played columns are
 * not judged again here: they were launched, they exist, and refusing them
 * retroactively would stop a run being deepened when one of its models has left
 * the favourites in the meantime. */
export function extendFavouritesProblem(
  request: ExtendRequest,
  favorites: readonly string[],
): string | null {
  return firstProblem(
    [
      ...(request.targets ?? []).map((id, index) => ({
        id,
        where: `targets[${index}]`,
      })),
      ...(request.new_judges ?? []).map((judge, index) => ({
        // A judge with no model takes the run's, which is already launched:
        // nothing to check, `notFavouriteProblem` lets the empty string pass.
        id: judge.model,
        where: `new_judges[${index}].model`,
      })),
      // An extension with no world of its own takes the run's, already
      // launched — the same remark as for `new_judges` above.
      // `notFavouriteProblem` lets the empty string pass.
      { id: request.world, where: "world" },
    ],
    favorites,
  );
}
