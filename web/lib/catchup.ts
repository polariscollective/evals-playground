// The catch-up predicate: which `judge_scores` rows still pending OR in error
// are genuinely catchable.
//
// Separated from `runs.ts`, which is `server-only` and which `node --test`
// cannot import — the same reason as `launch-judges.ts` and
// `run-judges-refusal.ts` beside it (see their head comments).
//
// THE TRAP this file exists to close, and which has already bitten this work
// once over awareness (see the design,
// docs/superpowers/specs/2026-09-06-juges-multiples.md) : une ligne de
// `judge_scores` en attente ou en erreur sur une liaison vivante n'est pas
// necessarily catchable — its conversation must ALSO be finished (`status =
// 'done'`). Le moteur (`catchup_dataset`, backend/playground/batch_job.py)
// applique ces trois conditions ensemble — en attente ou en erreur, liaison
// live link, finished conversation — and never catches up a conversation that
// is not. A count ignoring the third would announce "17 to catch up" for a
// catch-up that would do none, and the button would stay lit forever: that is
// this work's original bug, reproduced exactly if it is forgotten a second time
// — a second time already, on
// les lignes en erreur que le rattrapage ne reprenait pas : voir
// `catchupMissingTotal` (`runs.ts`), which now filters the same way as
// `catchup_dataset` (`status = "in.(pending,error)"`).
//
// One function carries this predicate, `catchupCandidateCount` below.
// `catchupMissingTotal` (`runs.ts`) est son seul appelant : c'est le compte
// the screen shows, and it is that same count the route triggering the
// catch-up reads back before starting the job — never a separate recomputation
// at that point.

/** Une ligne de `judge_scores` encore rattrapable au sens du statut — en
 *  pending or in error — already filtered on a live link. The name keeps
 *  « Pending » par habitude du chantier ; lire « en attente ou en erreur ». */
export interface PendingJudgeScore {
  sample_id: string;
}

/** Among `judge_scores` rows pending or in error, already filtered on live
 *  links, how many bear on a finished conversation
 *  (`doneSampleIds`) — donc sur lesquelles le prochain rattrapage va
 *  really write a verdict. */
export function catchupCandidateCount(
  pending: PendingJudgeScore[],
  doneSampleIds: ReadonlySet<string>,
): number {
  return pending.filter((row) => doneSampleIds.has(row.sample_id)).length;
}
