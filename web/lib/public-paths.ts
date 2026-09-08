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
 * qui reste derrière doit s'autoriser lui-même. `prompt`, `validate` et
 * `scenario-advice` ne lisent rien de privé — un texte fixe, un verdict sur ce
 * que l'appelant envoie déjà, ou le conseil par défaut, jamais la surcharge
 * qu'un profil aurait écrite : sans session, on ne sait pas qui demande, donc
 * rien qui dépende de qui demande ne peut sortir ici. `shared`, lui, lit la
 * base : c'est `loadPublicRun` qui refuse un run non publié, avec le même
 * message qu'un run inconnu, et c'est lui qui fait autorité — pas cette
 * liste. Toute future entrée sous ce préfixe hérite de cette obligation,
 * silencieusement : rien ici ne la rappelle par fichier. */
export const OPEN_PREFIXES = [
  // La connexion elle-même, sans quoi personne ne peut entrer.
  "api/auth",
  // The page that asks. Same status as `api/auth`, and for the same reason:
  // no one can sign in through a page that requires being signed in. Safe
  // behind an open door — it reads nothing and writes nothing.
  "signin",
  // Le mode d'emploi et le vérificateur : ils s'adressent à un agent, qui n'a
  // pas de session et ne saurait pas en obtenir une.
  "prompt",
  "validate",
  // Le conseil d'écriture de scénario, toujours sa version par défaut — voir
  // le commentaire de tête. Même public que `prompt` et `validate` : un agent
  // sans session, à qui le prompt donne cette adresse.
  "scenario-advice",
  // Un run publié.
  "shared",
  // Le viewer d'Inspect et les journaux qu'il lit. Même obligation que
  // `shared`, et c'est `canReadRun` qui la tient : un run mis à la corbeille ou
  // non publié se refuse à un inconnu, avec le 404 d'un run qui n'existe pas.
  "inspect-view",
  // Le connecteur MCP et son serveur d'autorisation : une machine sans
  // session, comme prompt et validate.
  "mcp",
  ".well-known",
  "_next/static",
  "_next/image",
];

/** The open files: anchored on the end, not on a directory.
 *
 * The tab's two icons, which Next serves under these exact names out of
 * `app/` and announces both of in the `<head>`. Closing the second would make
 * the badge vanish on `/shared` — the only place someone without a session
 * looks at a page, and so the only place the omission would show. The query
 * string Next appends behind them changes nothing: the matcher reads the path
 * alone. */
export const OPEN_FILES = ["favicon.ico", "icon.svg"];

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
