// What a stranger may read of a published run.
//
// One function decides, and it is pure: the public page goes through here, and
// nothing else should decide alone what goes out. Separated from `runs.ts`,
// which is `server-only` and which `node --test` cannot import.
import type { EvalRun, Judge, RunDetail, RunExtensionLogEntry, RunJudgeView } from "./types";

/** An extension as a stranger may read it: without the address of whoever asked
 *  for it. `via` stays — knowing an extension came from an agent or from the
 *  screen names nobody. */
export type PublicExtensionLogEntry = Omit<RunExtensionLogEntry, "by">;

/** A run as a stranger may read it: without the address of whoever launched
 *  it, nor those of whoever extended it. The second hides inside an array, and
 *  that is exactly why it is removed by the type rather than left to
 *  vigilance: `user_email` had been made impossible to read, and
 *  `extensions[].by` nearly got through because it was not at the root. */
export type PublicRun = Omit<EvalRun, "user_email" | "extensions"> & {
  extensions: PublicExtensionLogEntry[];
};

/** A judge as a stranger may read it: without `created_by`, the address of
 *  whoever created it — the same reason, and the same risk, as `PublicRun`
 *  removing `user_email`: a judge added after the fact by somebody other than
 *  whoever launched the run would otherwise carry a second address all the way
 *  to the public page, by a path `withoutIdentity` would not have closed. */
export type PublicJudge = Omit<Judge, "created_by">;

/** The public counterpart of `RunJudgeView` (`lib/types.ts`): its judge is a
 *  `PublicJudge`, never a whole `Judge` — see `PublicJudge`. */
export interface PublicRunJudgeView extends Omit<RunJudgeView, "judge"> {
  judge: PublicJudge;
}

/** The public counterpart of `RunDetail`. Distinct rather than retyping `run`
 *  as `EvalRun` and crossing fingers: a future access to `.run.user_email` on
 *  what `loadPublicRun` returns becomes a compilation error, not an `undefined`
 *  discovered at runtime — which is precisely the kind of error this function
 *  exists to make impossible. `judges` is rewritten for the same reason: without
 *  this `Omit`, a complete `RunJudgeView[]` (with `created_by`) would satisfy
 *  this type structurally, and the compiler could refuse nothing any more. */
export interface PublicRunDetail extends Omit<RunDetail, "run" | "judges"> {
  run: PublicRun;
  judges?: PublicRunJudgeView[];
}

/** The run as it goes out, without the address of whoever launched it, nor that
 *  of whoever created each of its judges.
 *
 * Those two alone are removed. The run's notes, the analysis, each scenario's
 * private note and the source CSV go out with the rest: that is the design's
 * decision, taken knowing these fields were written in private. Do not "fix"
 * that without reopening the question — the test says so too.
 *
 * A shallow copy, not a mutation: `run` and the returned object are fresh, but
 * `run.config`, `samples` and `progress` stay shared by reference with the
 * original, which comes from a read the private page shares too. Nothing here
 * mutates them; a future caller that did would mutate the private page's version
 * along with it. */
export function withoutIdentity(detail: RunDetail): PublicRunDetail {
  const { user_email, extensions, ...run } = detail.run;
  return {
    ...detail,
    run: {
      ...run,
      // `?? []` and not `extensions.map`: a row read without this column — a
      // narrower `select`, data written before it existed — must not bring the
      // public page down over a matter of extensions it does not have anyway.
      extensions: (extensions ?? []).map(({ by, ...entry }) => entry),
    },
    // `?.map` and not a direct access: `judges` is absent when `loadRun` was
    // not called with `withJudges` — see `RunDetail.judges`.
    judges: detail.judges?.map(({ judge, ...liaison }) => {
      const { created_by, ...publicJudge } = judge;
      return { ...liaison, judge: publicJudge };
    }),
  };
}
