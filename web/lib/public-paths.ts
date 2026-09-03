// Ce qui ne passe pas par la porte, en une seule liste.
//
// Le proxy ne peut pas appeler cette fonction : Next exige que `matcher` soit
// une constante analysable à la compilation et ignore toute valeur calculée —
// le proxy tournerait alors sur tous les chemins, `_next/static` compris. Le
// littéral reste donc écrit là-bas, et un test tient leur accord.

/** Les répertoires ouverts, ancrés sur `/` ou la fin exacte. Sans l'ancrage, un
 *  simple préfixe laisserait passer un chemin voisin plus long.
 *
 * Ouvrir un chemin ici ne le rend pas sûr : ça enlève seulement la porte. Ce
 * qui reste derrière doit s'autoriser lui-même. `prompt` et `validate` ne
 * lisent rien — un texte fixe, un verdict sur ce que l'appelant envoie déjà.
 * `shared`, lui, lit la base : c'est `loadPublicRun` qui refuse un run non
 * publié, avec le même message qu'un run inconnu, et c'est lui qui fait
 * autorité — pas cette liste. Toute future entrée sous ce préfixe hérite de
 * cette obligation, silencieusement : rien ici ne la rappelle par fichier. */
export const OPEN_PREFIXES = [
  // La connexion elle-même, sans quoi personne ne peut entrer.
  "api/auth",
  // Le mode d'emploi et le vérificateur : ils s'adressent à un agent, qui n'a
  // pas de session et ne saurait pas en obtenir une.
  "prompt",
  "validate",
  // Un run publié.
  "shared",
  "_next/static",
  "_next/image",
];

/** Le seul fichier ouvert : ancré sur la fin, pas sur un répertoire. */
export const OPEN_FILES = ["favicon.ico"];

/** Le point est le seul caractère de ces chemins qu'une expression régulière
 *  lirait autrement que lui-même. */
function escaped(path: string): string {
  return path.replace(/\./g, "\\.");
}

/** Le motif que Next donne au proxy : tout, sauf ce qui précède. */
export function proxyMatcher(): string {
  const alternatives = [
    ...OPEN_PREFIXES.map((prefix) => `${escaped(prefix)}(?:/|$)`),
    ...OPEN_FILES.map((file) => `${escaped(file)}$`),
  ];
  return `/((?!${alternatives.join("|")}).*)`;
}

/** Ce chemin passe-t-il sans session ?
 *
 * Dérivé du motif et non réécrit à côté : deux formulations de la même règle
 * finiraient par ne plus dire pareil, et c'est cette dérive-là qu'on teste. */
export function isOpen(pathname: string): boolean {
  return !new RegExp(`^${proxyMatcher()}$`).test(pathname);
}
