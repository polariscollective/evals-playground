// Les modèles qu'une personne veut voir proposés, et rien d'autre.
//
// Le catalogue compte quarante et un modèles ; un menu de quarante et une
// entrées est pire que neuf. Chacun choisit donc ce qu'il en voit, et cette
// liste décide de tout ce qui PROPOSE — les écrans, le prompt de l'agent, les
// outils MCP.
//
// Ce qu'elle ne décide pas, jamais : ce qui EXISTE. `knownModelIds()` reste
// seule à répondre à cette question-là, et c'est elle que `configProblem`
// consulte. Un run déjà lancé s'affiche donc avec ses modèles quoi qu'il
// arrive aux favoris, et une relance humaine reste lançable.
//
// Sans Supabase ni session : la même règle sert au formulaire, qui refuse
// avant d'envoyer, et à la route, qui refuse même si le formulaire a été
// contourné.
import { knownModelIds } from "./catalog.ts";

/** Le modèle sur lequel une page de run vierge s'ouvre.
 *
 * Nommé, et non déduit du premier de la liste : tant qu'il était déduit, un
 * réordonnancement du catalogue déplaçait le défaut sans que personne le
 * demande — l'élargissement à quarante et un modèles a ainsi fait passer
 * l'ouverture d'Opus 5 à Fable 5.1, et doublé le devis d'une page vierge en
 * silence. Un nom résiste à l'ordre.
 *
 * Sonnet 5 : le dernier Sonnet, et le moins cher des trois du catalogue. Il
 * ignore la température, comme tout Claude 4.7 et au-delà — donc une page
 * vierge affiche l'avertissement. C'est vrai, et le dire vaut mieux que de
 * choisir un modèle plus ancien pour l'éviter. */
export const DEFAULT_RUN_MODEL = "anthropic/claude-sonnet-5";

/** Ce qu'on propose à qui n'a rien choisi.
 *
 * Les neuf modèles que le produit proposait quand le catalogue était écrit à
 * la main, plus Fable 5.1. Vit dans le code et non en base : une ligne de
 * `profiles` qui recopierait cette liste ne recevrait plus jamais ce qu'on y
 * ajoutera — voir la migration `profiles_favorite_models`, qui porte le même
 * raisonnement que `scenario_advice` avant elle. */
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

/** Les modèles à proposer à cette personne.
 *
 * `null` — le profil absent comme la colonne vide — rend le défaut. Ne pas
 * savoir qui regarde n'est pas une raison de ne rien proposer : une route
 * publique comme `/prompt` passe ici sans profil et doit servir quelque
 * chose.
 *
 * Les identifiants qui ne sont plus au catalogue sont écartés à la lecture
 * plutôt qu'à l'écriture : la liste est écrite à un instant, le catalogue
 * bouge sans elle, et un menu ne doit pas porter une entrée dont le seul
 * effet serait d'échouer au premier appel facturé. Si le tri ne laisse rien,
 * on retombe sur le défaut — un menu vide rendrait l'application
 * inutilisable sans qu'on puisse deviner pourquoi. */
export function favoriteModels(
  profile: { favorite_models: string[] | null } | null,
): string[] {
  const written = profile?.favorite_models;
  if (!written) return [...DEFAULT_FAVORITE_MODELS];
  const known = knownModelIds();
  const alive = written.filter((id) => known.has(id));
  return alive.length > 0 ? alive : [...DEFAULT_FAVORITE_MODELS];
}

/** `null` si `value` peut devenir une liste de favoris, sinon ce qui cloche.
 *
 * Le tableau vide est refusé ici plutôt qu'en base : la contrainte se dit
 * mieux en une phrase qu'en SQL, et c'est cette phrase que le formulaire
 * affiche. Sans un seul favori, tous les menus de l'application seraient
 * vides.
 *
 * Un doublon est refusé plutôt que dédoublonné en silence : il vient d'un
 * client qui s'est trompé, et le corriger sans le dire cache l'erreur. */
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

/** Le refus d'un modèle qui existe mais que cette personne ne s'est pas
 *  choisi, ou `null`.
 *
 * Ne dit rien d'un identifiant hors catalogue : `configProblem` l'a déjà
 * refusé avec son propre message, et lui répondre « ajoute-le à tes
 * favoris » enverrait corriger un profil qui ne pourra jamais le contenir.
 * Les deux refus sont distincts parce que les deux gestes de réparation le
 * sont.
 *
 * Une chaîne vide passe : plusieurs champs de modèle sont facultatifs, et un
 * champ absent n'est pas un modèle refusé. */
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
