/** Garde l'état précédent quand les données n'ont pas bougé.
 *
 * Un sondage renvoie un objet neuf à chaque fois, même quand la base n'a rien
 * changé. Le poser tel quel dans l'état fait redessiner toute la page toutes
 * les trois secondes : les lignes clignotent, une sélection de texte saute, et
 * l'écran paraît se recharger sans fin.
 *
 * La comparaison passe par la sérialisation plutôt que par une égalité
 * profonde écrite à la main : les charges utiles ici font quelques kilo-octets,
 * et une comparaison qui oublierait un champ serait pire que pas de
 * comparaison du tout — l'écran cesserait de refléter la base. */
export function keepIfUnchanged<T>(previous: T | null, next: T): T | null {
  if (previous !== null && JSON.stringify(previous) === JSON.stringify(next)) {
    return previous;
  }
  return next;
}
