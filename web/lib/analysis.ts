// Ce qui protège l'analyse d'un run contre une écriture faite sans l'avoir lue.
//
// Le seul appelant est `update_run_analysis` (MCP) : la route HTTP
// `/api/runs/[runId]/analysis` écrit sans condition, parce qu'elle sert un
// éditeur où l'humain voit déjà, à l'écran, ce qu'il remplace. Un agent, lui,
// n'a que ce que l'outil lui rend — d'où `replaces`.

/** Une écriture est permise quand l'analyse actuelle est vide — il n'y a rien
 *  à perdre — ou quand `replaces` désigne ce qu'elle contient déjà, comparé
 *  aux blancs de début et de fin près : une copie qui transite par un appel
 *  d'outil gagne ou perd couramment un retour à la ligne final, qui ne change
 *  rien au sens du texte. */
export function analysisReplaceAllowed(
  current: string,
  replaces: string | undefined,
): boolean {
  if (current.trim() === "") return true;
  return replaces !== undefined && replaces.trim() === current.trim();
}
