// Ce qui protège les champs libres d'un run — `notes` et `analysis` — contre
// une écriture faite sans les avoir lus.
//
// Le seul appelant est `update_run_text` (MCP), pour les deux champs : les
// routes HTTP `/api/runs/[runId]/notes` et `/api/runs/[runId]/analysis`
// écrivent sans condition, parce qu'elles servent un éditeur où l'humain voit
// déjà, à l'écran, ce qu'il remplace. Un agent, lui, n'a que ce que l'outil
// lui rend — d'où `replaces`. Le nom du fichier date d'avant que l'outil ne
// couvre `notes` aussi ; la règle ne dépend pas du champ.

/** Une écriture est permise quand le champ actuel est vide — il n'y a rien à
 *  perdre — ou quand `replaces` désigne ce qu'il contient déjà, comparé aux
 *  blancs de début et de fin près : une copie qui transite par un appel
 *  d'outil gagne ou perd couramment un retour à la ligne final, qui ne change
 *  rien au sens du texte. */
export function analysisReplaceAllowed(
  current: string,
  replaces: string | undefined,
): boolean {
  if (current.trim() === "") return true;
  return replaces !== undefined && replaces.trim() === current.trim();
}
