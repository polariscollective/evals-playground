// The catch-up predicate: which `judge_scores` rows still pending OR in error
// are genuinely catchable.
//
// Separated from `runs.ts`, which is `server-only` and which `node --test`
// cannot import — the same reason as `launch-judges.ts` and
// `run-judges-refusal.ts` beside it (see their head comments).
//
// THE TRAP this file exists to close, and which has already bitten this work
// once over awareness (see the design,
// docs/superpowers/specs/2026-09-06-juges-multiples.md): a `judge_scores` row
// pending or in error on a live link is not necessarily catchable — its
// conversation must ALSO be finished (`status = 'done'`). The engine
// (`catchup_dataset`, backend/playground/batch_job.py) applies those three
// conditions together — pending or in error, live link, finished conversation —
// and never catches up a conversation that is not. A count ignoring the third
// would announce "17 to catch up" for a catch-up that would do none, and the
// button would stay lit forever: that is this work's original bug, reproduced
// exactly if it is forgotten a second time — a second time already, over the
// rows in error the catch-up did not take up: see `catchupMissingTotal`
// (`runs.ts`), which now filters the same way as `catchup_dataset`
// (`status = "in.(pending,error)"`).
//
// One function carries this predicate, `catchupCandidateCount` below.
// `catchupMissingTotal` (`runs.ts`) is its only caller: it is the count the
// screen shows, and it is that same count the route triggering the catch-up
// reads back before starting the job — never a separate recomputation at that
// point.

/** A `judge_scores` row still catchable as far as its status goes — pending or
 *  in error — already filtered on a live link. The name keeps "Pending" out of
 *  the habit of this work; read it as "pending or in error". */
export interface PendingJudgeScore {
  sample_id: string;
}

/** Among `judge_scores` rows pending or in error, already filtered on live
 *  links, how many bear on a finished conversation (`doneSampleIds`) — and so on
 *  which the next catch-up will really write a verdict. */
export function catchupCandidateCount(
  pending: PendingJudgeScore[],
  doneSampleIds: ReadonlySet<string>,
): number {
  return pending.filter((row) => doneSampleIds.has(row.sample_id)).length;
}
