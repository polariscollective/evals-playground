// Le prédicat du rattrapage : quelles lignes de `judge_scores` encore en
// attente OU en erreur sont réellement rattrapables.
//
// Séparé de `runs.ts`, qui est `server-only` et que `node --test` ne peut pas
// importer — même raison que `launch-judges.ts` et `run-judges-refusal.ts`
// à côté (voir leurs commentaires de tête).
//
// LE PIÈGE que ce fichier existe pour fermer, et qui a déjà mordu ce
// chantier une fois sur l'éveil (voir la conception,
// docs/superpowers/specs/2026-09-06-juges-multiples.md) : une ligne de
// `judge_scores` en attente ou en erreur sur une liaison vivante n'est pas
// forcément rattrapable — sa conversation doit AUSSI être terminée (`status =
// 'done'`). Le moteur (`catchup_dataset`, backend/playground/batch_job.py)
// applique ces trois conditions ensemble — en attente ou en erreur, liaison
// vivante, conversation terminée — et ne rattrape jamais une conversation qui
// ne l'est pas. Un compte qui ignorerait la troisième annoncerait « 17 à
// rattraper » pour un rattrapage qui en ferait zéro, et le bouton resterait
// allumé pour toujours : c'est le bug d'origine de ce chantier, reproduit à
// l'identique si on l'oublie une seconde fois — une deuxième fois déjà, sur
// les lignes en erreur que le rattrapage ne reprenait pas : voir
// `catchupMissingTotal` (`runs.ts`), qui filtre désormais pareil que
// `catchup_dataset` (`status = "in.(pending,error)"`).
//
// Une seule fonction porte ce prédicat, `catchupCandidateCount` ci-dessous.
// `catchupMissingTotal` (`runs.ts`) est son seul appelant : c'est le compte
// qu'affiche l'écran, et c'est ce même compte que relit la route qui
// déclenche le rattrapage avant de démarrer le job — jamais un recalcul
// séparé à cet endroit-là.

/** Une ligne de `judge_scores` encore rattrapable au sens du statut — en
 *  attente ou en erreur — déjà filtrée sur une liaison vivante. Le nom garde
 *  « Pending » par habitude du chantier ; lire « en attente ou en erreur ». */
export interface PendingJudgeScore {
  sample_id: string;
}

/** Parmi des lignes de `judge_scores` en attente ou en erreur, déjà filtrées
 *  sur des liaisons vivantes, combien portent sur une conversation terminée
 *  (`doneSampleIds`) — donc sur lesquelles le prochain rattrapage va
 *  réellement écrire un verdict. */
export function catchupCandidateCount(
  pending: PendingJudgeScore[],
  doneSampleIds: ReadonlySet<string>,
): number {
  return pending.filter((row) => doneSampleIds.has(row.sample_id)).length;
}
