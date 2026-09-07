/** Ce qui s'affiche quand une liste ne contient rien.
 *
 * Une phrase et un bouton, rien de plus. La version d'avant expliquait d'où
 * viennent les brouillons et comment en soumettre un — un mode d'emploi utile
 * une fois, servi à chaque fois qu'un filtre écarte tout le monde. Or c'est
 * presque toujours le filtre qui vide la table, pas la base : la seule chose
 * qu'on veut à ce moment-là est de pouvoir revenir en arrière.
 *
 * Le même composant pour les deux listes : elles se vident pour la même raison
 * et se récupèrent du même geste.
 */
export function EmptyTable({
  onClear,
  onDefault,
}: {
  onClear: () => void;
  onDefault: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-zinc-200 py-6 text-sm text-zinc-600">
      <span>Empty table with this filter.</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
      >
        clear filters
      </button>
      <button
        type="button"
        onClick={onDefault}
        className="rounded border border-zinc-300 px-3 py-1 text-xs hover:bg-zinc-50"
      >
        default filters
      </button>
    </div>
  );
}
