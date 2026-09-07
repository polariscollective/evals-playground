// Le contrôleur d'un run servi : le jumeau TypeScript de
// `check_model_for` (backend/playground/world.py).
//
// Le serveur (`config.models.world`) est un choix par run depuis Task 2 ; le
// contrôleur ne peut donc plus être une constante unique — un contrôleur fixe
// deviendrait creux, sans le dire, le jour où le serveur choisi partage sa
// famille. Toute la valeur du contrôle tient à ce qu'il ne partage pas les
// travers du serveur : un contrôleur de la même famille trouve ses
// inventions plausibles, parce qu'il les aurait faites aussi.
//
// Le contrôleur reste hors de la configuration du run : ce n'est pas une
// question sur l'expérience, c'est la façon dont l'outil se contrôle
// lui-même.

/** Le contrôleur d'un run servi : le premier candidat d'un autre fournisseur
 *  que le serveur.
 *
 * Aucun candidat d'un autre fournisseur est une faute du fichier partagé, pas
 * un cas d'exécution — un test exige que la liste en couvre deux. Le repli sur
 * le premier existe pour ne jamais rendre `undefined` à l'appelant. */
export function checkModelFor(
  worldModel: string,
  candidates: readonly string[],
): string {
  const fournisseur = worldModel.split("/")[0];
  return (
    candidates.find((id) => id.split("/")[0] !== fournisseur) ?? candidates[0]
  );
}
