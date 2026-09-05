// Valide un plafond de dépense tel qu'on le tape dans le formulaire de
// profil, avant que la route ne l'écrive dans `profiles` — voir
// `updateProfileCaps` dans `profiles.ts`.
//
// Sans Supabase ni session : la même règle sert au formulaire, qui refuse
// avant d'envoyer, et à la route, qui refuse même si le formulaire a été
// contourné.

/** Au-delà, c'est une faute de frappe, pas une intention.
 *
 * Un run de ce produit coûte des centimes à quelques dollars ; les défauts
 * sont 2 et 10. Une borne à cent laisse donc toute la place à un usage réel
 * tout en arrêtant le chiffre saisi avec un zéro de trop — et un plafond de
 * dépense qu'une glissade de clavier peut lever ne protège de rien. */
const CAP_MAX = 100;

/** `null` si `value` peut devenir un plafond, sinon ce qui cloche.
 *
 * Zéro est permis, et c'est même le seul frein d'urgence qui reste : à zéro,
 * tout devis strictement positif est refusé, donc les agents de cette personne
 * ne dépensent plus rien. C'est le geste qu'on veut pouvoir faire vite.
 *
 * Le négatif, lui, n'a pas de sens : aucun devis ne lui est inférieur, donc il
 * se lirait comme zéro tout en ayant l'air de dire autre chose.
 *
 * `NaN` est ce que rend un champ vidé pendant la frappe ; l'écran s'en sert
 * pour désactiver « Save » sans avoir à écrire une seconde règle. */
export function capProblem(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "must be zero or a positive number";
  }
  if (value > CAP_MAX) {
    return `must be at most ${CAP_MAX} — a higher cap is more likely a typo than an intent`;
  }
  return null;
}
