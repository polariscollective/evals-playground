// Ce qu'on retient d'une connexion MCP, et à quelle fréquence.
//
// Deux décisions minuscules, sorties de `mcp-auth.ts` parce que celui-ci
// importe `server-only` et parle à la base : ici, rien que des fonctions
// pures, donc la seule partie de cette histoire que `node --test` sache tenir.

/** Entre deux écritures de `last_used_at`. La colonne sert à voir ce qui vit,
 *  pas à compter les appels : la toucher à chaque requête ajouterait un aller-
 *  retour par appel d'outil pour une précision dont personne n'a l'usage. */
export const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Au-delà, on tronque : un agent utilisateur est parfois une tirade, et cette
 *  colonne n'est qu'un indice sur qui appelle. */
export const MAX_CLIENT_LABEL = 200;

/** Faut-il réécrire `last_used_at` ? Oui s'il est vide — le grant n'a jamais
 *  servi — ou s'il date de plus d'un intervalle. Une valeur illisible compte
 *  comme vide : mieux vaut une écriture de trop qu'une colonne figée sur une
 *  date que personne ne sait relire. */
export function needsTouch(lastUsedAt: string | null, now: Date = new Date()): boolean {
  if (!lastUsedAt) return true;
  const then = new Date(lastUsedAt).getTime();
  if (Number.isNaN(then)) return true;
  return now.getTime() - then >= TOUCH_INTERVAL_MS;
}

/** L'agent utilisateur tel qu'on le garde, ou `null` s'il n'y en a pas.
 *
 * On ne le traduit pas en nom commercial : deviner « claude.ai » à partir
 * d'une chaîne qu'on n'a pas encore observée reviendrait à afficher une
 * certitude qu'on n'a pas. Brut, il dit au moins la vérité. */
export function clientLabelOf(userAgent: string | null | undefined): string | null {
  const trimmed = (userAgent ?? "").trim();
  return trimmed ? trimmed.slice(0, MAX_CLIENT_LABEL) : null;
}
