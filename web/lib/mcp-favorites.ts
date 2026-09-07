// Le refus d'un modèle hors favoris — et cet endroit est le seul.
//
// `configProblem` continue de valider contre le catalogue ENTIER, et c'est
// voulu : un run déjà lancé doit s'afficher avec ses modèles, et une relance
// pré-remplie doit rester lançable à la main. C'est l'agent qu'on borne, pas
// la personne.
//
// D'où ce module à part plutôt qu'une branche dans `validate.ts` : le jour où
// quelqu'un ajoutera un appelant à `configProblem`, il n'héritera pas d'un
// refus qui n'a de sens que par MCP.
import { notFavouriteProblem } from "./favorite-models.ts";
import type { EvalRunConfig, ExtendRequest } from "./types";

/** Le premier modèle hors favoris d'une liste, formulé, ou `null`.
 *
 * Le premier et non tous : le message dit quoi faire, et une énumération de
 * cinq refus n'aide pas plus qu'un seul à retrouver son profil. */
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

/** Ce qui, dans les modèles d'un run, n'est pas dans les favoris de
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
      ...(config.judges ?? []).map((judge, index) => ({
        id: judge.model,
        where: `judges[${index}].model`,
      })),
    ],
    favorites,
  );
}

/** Ce qui, dans les modèles qu'une extension ajoute, n'est pas dans les
 *  favoris de l'appelant — ou `null`.
 *
 * Ne regarde que ce que l'extension AJOUTE. Les colonnes déjà jouées du run
 * ne sont pas rejugées ici : elles ont été lancées, elles existent, et les
 * refuser rétroactivement empêcherait d'approfondir un run dont un modèle a
 * quitté les favoris entre-temps. */
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
        // Un juge sans modèle reprend celui du run, qui est déjà lancé :
        // rien à vérifier, `notFavouriteProblem` laisse passer la chaîne vide.
        id: judge.model,
        where: `new_judges[${index}].model`,
      })),
    ],
    favorites,
  );
}
