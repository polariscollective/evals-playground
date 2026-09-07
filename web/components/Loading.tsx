/** Les deux façons de dire « ça travaille », selon qu'il y ait déjà quelque
 *  chose à lire ou non.
 *
 * Trois points plutôt qu'un mot, dans les deux cas : il n'y a rien à lire ici,
 * seulement à attendre. Le mot reste pour les lecteurs d'écran, qui ne voient
 * pas l'animation.
 */

/** Rien à afficher encore : on tient la place du contenu.
 *
 * Posé dans le flux, à l'endroit exact où le contenu s'écrira — même colonne,
 * même bord gauche. Un message centré, ou un bloc à une autre largeur, fait
 * sauter la page au moment où les données arrivent : on lit une chose, elle se
 * déplace, et on a l'impression que tout se recharge. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="text-sm text-zinc-400">
      <span className="animate-pulse">•••</span>
      <span className="sr-only">{label}</span>
    </p>
  );
}

/** Il y a déjà quelque chose à lire, et on le revérifie.
 *
 * Se glisse à côté d'un texte existant plutôt que de le remplacer : le contenu
 * du cache reste lisible pendant la vérification, c'est tout l'objet du cache.
 * Ne jamais l'afficher en même temps que `Loading` — deux voyants pour le même
 * état diraient deux fois la même chose. */
export function Refreshing({ label = "Refreshing" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center text-xs text-teal-700">
      <span className="animate-pulse">•••</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
