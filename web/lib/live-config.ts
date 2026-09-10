// A run's configuration, as it must be PRESENTED: on download (the MCP tool
// `get_run_config`), on duplication (the form taken back from an existing run),
// or anywhere else that shows "this run's judges".
//
// `EvalRun.config` stays the frozen trace of what was asked at launch — we do
// not touch it, and `search_runs` (search by original criterion) as much as the
// extension history keep reading it as it stands: they answer "what had been
// asked", not "who judges this run today".
//
// WHY DERIVE RATHER THAN COPY: having the addition or the removal of a judge
// written into `config` would give two places to hold in agreement — the living
// link in `run_judges`, and its copy in `config.judges`. This project has
// already produced three real examples of that this week alone (a button that
// counted differently from the engine, a form that ignored a field, a quote
// that billed a text never sent): two truths about the same question always end
// up diverging, never staying in agreement. By deriving on READING from the
// living links — never by writing the addition or the removal into `config` —
// there is only one place that decides who a run's judges are today:
// `loadLiveRunJudges` (`runs.ts`), already the one that feeds the screen and
// the reading MCP tools. If someone one day "fixes" this by having the addition
// written into `config` at `addJudge` time, the hole this file exists to close
// will reopen: a judge unlinked since would stay visible, or a judge added
// through another door would not appear here.
//
// A pure function, with no access to the database — which is why it is not
// marked `server-only`, unlike `runs.ts`: duplication needs it on the browser
// side, with the judges already loaded by the page (`RunDetail.judges`),
// without reproducing this logic a second time for it. Same reason for the
// separation as `public-run.ts`.
import type {
  EvalRunConfig,
  Judge,
  JudgeSystemTypeColumn,
} from "./types";

const AWAKE: JudgeSystemTypeColumn = "awake";

/** A run's living judge, reduced to what this derivation needs — satisfied
 *  just as well by `LiveRunJudge` (`runs.ts`) as by `RunJudgeView`
 *  (`types.ts`), the two shapes under which a caller may have already loaded a
 *  run's living judges. */
export interface JudgeForConfig {
  judge: Judge;
  is_principal: boolean;
  system_type: JudgeSystemTypeColumn;
  /** The model that graded, read from the LINK since judges became a library:
   *  the same question put to two models is one judge, not two. */
  model: string;
}

/** A run's configuration, with its judges replaced by those really living
 *  today — see this file's header for why.
 *
 * What changes with respect to `config` as it stands:
 * - `criterion`, `rubric`, `models.judge` become those of the living
 *   PRINCIPAL — not necessarily the one at launch, if `designatePrincipal` has
 *   transferred the title since. Same fallback as `get_run_metadata` and the
 *   screen (`JudgeBlock`, `components/RunRead.tsx`) when no principal is alive
 *   (every judge has been unlinked): we fall back on what `config` said at
 *   launch, rather than returning a configuration with no criterion at all — a
 *   run with no judge stays relaunchable.
 * - `judges` (the secondaries) becomes one `JudgeSpec` per living ORDINARY
 *   judge, principal aside: those added afterwards (`addJudge`) appear there,
 *   those unlinked (`unlinkJudge`) disappear from it. A system judge (the
 *   awareness one) never figures there — that is not its shape, see
 *   `check_eval_awareness` just below.
 * - `check_adversary_fidelity` likewise, for the adversary-fidelity link.
 * - `check_eval_awareness` reflects whether the awareness link is still alive
 *   NOW, never what `config` had asked at launch: an unlinked awareness judge
 *   must not come back to life at the next relaunch made from this
 *   configuration, and a run predating this field whose awareness is still
 *   running must keep saying so.
 *
 * All the rest — scenarios, turns, repetitions, tools, temperature, target
 * models, adversary, source... — has no counterpart in `run_judges`: copied as
 * it stands from `config`. */
export function withLiveJudges(
  config: EvalRunConfig,
  live: JudgeForConfig[],
): EvalRunConfig {
  const principal = live.find((entry) => entry.is_principal);
  const secondaries = live.filter(
    (entry) => !entry.is_principal && entry.system_type === "ordinary",
  );
  const awakeStillLinked = live.some((entry) => entry.system_type === AWAKE);
  // Same reading as the awareness link, opposite default. Unlinking the
  // fidelity judge must not bring it back to life at the next relaunch made
  // from this configuration.
  const fidelityStillLinked = live.some(
    (entry) => entry.system_type === "faithful_adversary",
  );

  return {
    ...config,
    criterion: principal?.judge.criterion ?? config.criterion,
    rubric: principal?.judge.rubric ?? config.rubric,
    models: {
      ...config.models,
      judge: principal?.model ?? config.models.judge,
    },
    judges: secondaries.map((entry) => ({
        // Not null in practice: a judge with `system_type === "ordinary"`
        // always carries its criterion and its scale — see `Judge` in
        // `types.ts` and the `judges_ordinary_or_system_check` constraint in the
        // database. The fallback is there only to satisfy the type, never
        // reached.
      criterion: entry.judge.criterion ?? "",
      rubric: entry.judge.rubric ?? [],
      model: entry.model,
    })),
    check_eval_awareness: awakeStillLinked,
    check_adversary_fidelity: fidelityStillLinked,
  };
}
