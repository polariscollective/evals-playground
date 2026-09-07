/** Ce qu'une ligne de brouillon affiche : sa forme, son devis, son état de
 *  préparation.
 *
 * Une extension ne se chiffre pas ici, et c'est un fait, pas un oubli :
 * `estimateExtension` et `extendProblem` exigent tous deux la configuration du
 * run étendu — combien de scénarios il porte, à quelle profondeur, quels
 * outils. La liste ne l'a pas, et l'aller chercher ferait une requête par
 * ligne. Mieux vaut un tiret honnête qu'un chiffre inventé : la page du run
 * dit tout, et c'est là que la fusée mène.
 */

import { estimateCost } from "./pricing.ts";
import { configProblem } from "./validate.ts";
import type { Draft } from "./types.ts";

/** Le nom affiché. Une extension n'a pas de titre à elle : ce qu'elle propose
 *  n'est pas un run mais un ajout à un run qui, lui, en a déjà un.
 *
 * Ici et non dans le tableau, parce que la recherche doit chercher exactement
 * ce que la liste montre — deux définitions du nom se seraient contredites au
 * premier renommage. */
export function draftName(draft: Draft): string {
  if (draft.kind === "extend") return "an extension of an existing run";
  return draft.config.label || "Untitled run";
}

/** Ce dans quoi la recherche fouille pour un brouillon.
 *
 * Son nom, son identifiant, et — pour une extension — celui du run qu'elle
 * agrandit. Ce dernier compte : on part souvent d'un run pour retrouver ce qui
 * attend d'y être ajouté, et sans lui il faudrait connaître par cœur
 * l'identifiant du brouillon.
 *
 * Ici et non dans la page, pour que ce qu'on cherche reste exactement ce que
 * la ligne montre. */
export function draftHaystacks(draft: Draft): (string | null)[] {
  return [draftName(draft), draft.id, draft.extends_run_id];
}

/** La forme que ce brouillon donnera : scénarios × modèles × répétitions.
 *
 * Pour une extension, ce sont les cases AJOUTÉES, d'où le « + » : ses
 * scénarios s'ajoutent à ceux que le run porte déjà, et afficher un total
 * qu'on n'a pas laisserait croire à la taille finale. */
export function draftShape(draft: Draft): string {
  if (draft.kind === "extend") {
    const scenarios =
      draft.config.scenario_indices.length + draft.config.new_scenarios.length;
    return `+${scenarios} × ${draft.config.targets.length} × ${draft.config.repetitions}`;
  }
  // Tolérant à l'incomplet : un brouillon du formulaire peut n'avoir encore
  // ni scénario ni modèle, et c'est précisément ce qu'on met de côté.
  const scenarios = draft.config.scenarios?.length ?? 0;
  const models = draft.config.models?.targets?.length ?? 0;
  return `${scenarios} × ${models} × ${draft.config.repetitions ?? 0}`;
}

/** Le devis, ou `null` quand il ne peut pas être calculé ici.
 *
 * `estimateCost` suppose une configuration entière ; un brouillon à moitié
 * écrit la lui donnerait incomplète. La garde rend `null` plutôt que de
 * laisser lever — une ligne de liste ne doit jamais faire tomber la page. */
export function draftCost(draft: Draft): number | null {
  if (draft.kind === "extend") return null;
  if (configProblem(draft.config) !== null) return null;
  try {
    return estimateCost(draft.config).usd;
  } catch {
    return null;
  }
}

/** Ce qui empêche ce brouillon de partir, ou `null` s'il est prêt.
 *
 * `undefined` : on ne peut pas le dire d'ici — le cas des extensions. Trois
 * états, donc, et non deux : « prêt », « il manque ceci », « je ne sais pas ».
 * Les confondre ferait passer une extension parfaitement valide pour un
 * brouillon cassé. */
export function draftBlocker(draft: Draft): string | null | undefined {
  if (draft.kind === "extend") return undefined;
  return configProblem(draft.config);
}

/** Où mène la fusée.
 *
 * Trois destinations, et aucune ne lance quoi que ce soit : lancer reste un
 * clic humain pris devant la configuration, jamais depuis une liste.
 *
 * Un brouillon déjà lancé mène au run qu'il a produit — c'est ce qu'on vient
 * voir. Une extension mène à la page de son run, dans le panneau prévu pour
 * elle : elle s'ajoute à un run, elle ne s'ouvre pas dans le formulaire. Un
 * brouillon de run neuf mène au formulaire, pré-rempli. */
export function draftDestination(draft: Draft): string {
  if (draft.launched_run_id) return `/eval/${draft.launched_run_id}`;
  if (draft.kind === "extend") {
    // Une extension appliquée n'a plus de proposition à rouvrir : elle a écrit
    // sur son run, et réappliquer n'est pas idempotent — `cellsForExtension`
    // numérote les répétitions à partir de la dernière, si bien qu'une seconde
    // application empile des essais au lieu de constater qu'il n'y a rien à
    // faire. Elle mène donc à ce qu'elle a fait, pas à ce qu'elle proposait.
    //
    // Un brouillon de run lancé, lui, garde sa destination : le relancer
    // produit un run de plus sans toucher au premier. C'est la même règle qui
    // est bonne d'un côté et fausse de l'autre.
    return draft.launched_at
      ? `/eval/${draft.extends_run_id}#extensions`
      : `/eval/${draft.extends_run_id}?extend=${draft.id}`;
  }
  return `/?draft=${draft.id}`;
}
