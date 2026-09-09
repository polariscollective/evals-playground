// What a stranger may read of a published run.
//
// One function decides, and it is pure: the public page goes through here, and
// nothing else should decide alone what goes out. Separated from
// `runs.ts`, qui est `server-only` et que `node --test` ne peut pas importer.
import type { EvalRun, Judge, RunDetail, RunExtensionLogEntry, RunJudgeView } from "./types";

/** Une extension telle qu'un inconnu peut la lire : sans l'adresse de qui l'a
 *  asked for. `via` stays — knowing an extension came from an agent or from
 *  the screen names nobody. */
export type PublicExtensionLogEntry = Omit<RunExtensionLogEntry, "by">;

/** A run as a stranger may read it: without the address of whoever launched
 *  it, nor those of whoever extended it. The second hides inside an array, and
 *  that is exactly why it is removed by the type rather than left to
 *  vigilance: `user_email` had been made impossible to read, and
 *  `extensions[].by` nearly got through because it was not at the root. */
export type PublicRun = Omit<EvalRun, "user_email" | "extensions"> & {
  extensions: PublicExtensionLogEntry[];
};

/** Un juge tel qu'un inconnu peut le lire : sans `created_by`, l'adresse de
 *  whoever created it — the same reason, and the same risk, as `PublicRun`
 *  removing `user_email`: a judge added after the fact by somebody other than
 *  whoever launched the run would otherwise carry a second address all the way
 *  to the public page, by a path `withoutIdentity` would not have closed. */
export type PublicJudge = Omit<Judge, "created_by">;

/** Le pendant public de `RunJudgeView` (`lib/types.ts`) : son juge est un
 *  `PublicJudge`, jamais un `Judge` complet — voir `PublicJudge`. */
export interface PublicRunJudgeView extends Omit<RunJudgeView, "judge"> {
  judge: PublicJudge;
}

/** The public counterpart of `RunDetail`. Distinct rather than retyping `run`
 *  as `EvalRun` and crossing fingers: a future access to `.run.user_email` on
 *  ce que rend `loadPublicRun` devient une erreur de compilation, pas un
 *  `undefined` discovered at runtime — which is precisely the kind
 *  d'erreur que cette fonction existe pour rendre impossible. `judges` est
 *  rewritten for the same reason: without this `Omit`, a complete
 *  `RunJudgeView[]`
 *  (avec `created_by`) satisferait ce type par structure, et le compilateur
 *  ne pourrait plus rien refuser. */
export interface PublicRunDetail extends Omit<RunDetail, "run" | "judges"> {
  run: PublicRun;
  judges?: PublicRunJudgeView[];
}

/** The run as it goes out, without the address of whoever launched it, nor
 *  that of whoever created each of its judges.
 *
 * Those two alone are removed. The run's notes, the analysis, each scenario's
 * private note and the source CSV go out with the rest: that is the design's
 * decision, taken knowing these fields were written in private. Do not "fix"
 * that without reopening the question — the test says so
 * aussi.
 *
 * Une copie de surface, pas une mutation : `run` et l'objet rendu sont neufs,
 * but `run.config`, `samples` and `progress` stay shared by reference with the
 * original, which comes from a read the private page shares too.
 * Rien ici ne les mute ; un futur appelant qui le ferait muterait la version
 * private page with it. */
export function withoutIdentity(detail: RunDetail): PublicRunDetail {
  const { user_email, extensions, ...run } = detail.run;
  return {
    ...detail,
    run: {
      ...run,
      // `?? []` et non `extensions.map` : une ligne lue sans cette colonne —
      // a narrower `select`, data written before it existed — does not
      // doit pas faire tomber la page publique pour une histoire d'extensions
      // which it does not have anyway.
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
