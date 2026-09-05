// Valide un plafond de dépense tel qu'on le tape dans le formulaire de
// profil, avant que la route ne l'écrive dans `profiles` — voir
// `updateProfileCaps` dans `profiles.ts`.
//
// Sans Supabase ni session : la même règle sert au formulaire, qui refuse
// avant d'envoyer, et à la route, qui refuse même si le formulaire a été
// contourné.

/** `null` si `value` peut devenir un plafond, sinon ce qui cloche.
 *
 * Une seule règle : positif et fini. Zéro ou négatif rouvrirait le budget en
 * grand plutôt que de le fermer — l'inverse de ce qu'un plafond promet.
 * `NaN` est ce que rend un champ vidé pendant la frappe ; l'écran s'en sert
 * pour désactiver « Save » sans avoir à écrire une seconde règle. */
export function capProblem(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "must be a positive number";
  }
  return null;
}
