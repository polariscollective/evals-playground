// Reading and writing the runs. The only place that knows the shape of the two
// tables.
import "server-only";
import { randomUUID } from "node:crypto";
// The matrix is computed where it is looked at: the screen allows rereading a
// run another way — a median, a folded scale — and two computations of the same
// thing would end up no longer saying the same.
import { overallMean, progressOf } from "./matrix";
import { meanFromHistogram } from "./run-list-mean";
import { catchupCandidateCount } from "./catchup";
import {
  JUDGES,
  JUDGE_SCORES,
  MCP_LAUNCHES,
  NOW,
  RUNS,
  RUN_LIST,
  RUN_JUDGES,
  RUN_TAGS,
  SAMPLES,
  TOOL_RESULTS,
  SupabaseError,
  failStaleRuns,
  insert,
  remove,
  rpc,
  select,
  update,
} from "./supabase";
import { addEstimates, estimateCost, estimateJudgeAdditionCost } from "./pricing";
import { estimateExtension } from "./extend-estimate";
import { resolvedWorld } from "./tools";
import type { JobMode } from "./trigger";
import { withLiveJudges } from "./live-config";
import { measureRun, type MeasurableCell } from "./measured-length";
import type { ToolResultRow } from "./served";
import { cellsForExtension, cellsForRun, coupleKey } from "./cells";
import type { NewCell } from "./cells";
import {
  judgeRowFromSpec,
  judgesForLaunch,
  judgeScoresForSamples,
} from "./launch-judges.ts";
import { classifyRunJudgesRefusal } from "./run-judges-refusal";
import { withoutIdentity } from "./public-run";
import type { PublicRunDetail } from "./public-run";
// `AWAKE_TYPE`: the only thing borrowed from `awareness.ts` to find a run's
// awareness link — never `findAwakeJudge`, whose generic constraint
// (`T extends { system_type: JudgeSystemType | null }`) predates the sentinel
// and therefore no longer accepts a real `RunJudge` (`system_type:
// JudgeSystemTypeColumn`, which includes `"ordinary"`, not assignable to
// `JudgeSystemType | null`). Fixing that constraint belongs to `awareness.ts`,
// outside this task's scope — see the report.
import { AWAKE_TYPE, type JudgeVerdict } from "./awareness.ts";
import type {
  CostEstimate,
  EvalModels,
  EvalRun,
  EvalRunConfig,
  EvalSample,
  EvalScenario,
  ExtendRequest,
  Judge,
  JudgeScore,
  JudgeSpec,
  JudgeSystemTypeColumn,
  JudgeVerdictEntry,
  RunDetail,
  RunJudge,
  RunJudgeView,
  RunListItem,
  RunStatus,
  RubricLevel,
  RunSummary,
  SampleStatus,
  TemperatureSpec,
  ToolSpec,
} from "./types";

/** A cell's columns, transcript aside.
 *
 * A transcript weighs several kilobytes; bringing them all back to count
 * statuses would push megabytes over the network on every refresh, every three
 * seconds while a run is going.
 *
 * Since the multiple judges, this list no longer names `score`,
 * `justification`, `awareness_score`, `awareness_justification` or
 * `awareness_error`: the migration
 * `20260906093000_drop_eval_samples_score_columns.sql` (polaris-supabase
 * repository) dropped them from `eval_samples` — what a judge returned on a
 * conversation now lives in `judge_scores`, see `loadLiveRunJudges`,
 * `awarenessMissingTotal` and `loadRuns` below, which read it apart. `error`
 * stays a column of `eval_samples`: it carries the failure of the conversation's
 * *execution*, never a judge's — see `JudgeScore.error` for that second,
 * distinct sense. */
const SAMPLE_COLUMNS =
  "id,run_id,scenario_index,scenario_title,target_model,repetition,status," +
  // `usage` carries the cell's billed tokens. Small — five counters per model —
  // and no comparison with the transcripts, which are still brought back only on
  // demand. It is what lets the panel announce what its quote rests on, and
  // `extendRun` compute it the same way.
  //
  // `turns_done` says at what depth that particular cell played, and nothing
  // else says it: `config.turns` names only the last one asked for. A deepened
  // run carries cells at different depths — without this column, the panel
  // grouped them all at the run's depth and the measurement divided each by it.
  "turns_done,temperature,error,started_at,finished_at,cost_usd,usage";

export class NotFound extends Error {}

/** Unlinking a run's principal with no valid replacement, while other living
 *  links remain on that run.
 *
 * Laid by the database, not by this file — that is the change from an earlier
 * version of this comment, which described this as a net laid in the application
 * for want of such a guard in the database. The deferred trigger
 * `run_judges_require_principal_trg`
 * (`evals/supabase/migrations/20260906102248_require_run_judges_principal.sql`,
 * `polaris-supabase` repository) now guarantees, at commit time, that a run with
 * at least one living link always has exactly one principal. `unlinkJudge` now
 * does no more than translate its message — from the French of a server trace
 * into a readable English sentence — see `classifyRunJudgesRefusal`. */
export class PrincipalRequiresReplacement extends Error {}

/** How many attempts each scenario × model pair carries: the fewest, the most.
 *
 * Counted on the cells rather than read from `config.repetitions`, which says
 * only what had been asked for the last batch: a run completed in several goes
 * has some pairs fuller than others, and a cell's mean then bears on fewer
 * conversations than its neighbour's.
 *
 * Demands only two columns — not a whole `EvalSample` — so as to be satisfied
 * just as well by the cells of `loadRuns` (already reduced, and augmented with
 * the principal's verdict) as by a complete `EvalSample`. */
function repetitionRange(
  samples: Pick<EvalSample, "scenario_index" | "target_model">[],
): [number, number] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = coupleKey(sample.scenario_index, sample.target_model);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

/** A cell as `loadRuns` sees it: its coordinates and its execution status, plus
 *  the PRINCIPAL judge's verdict — never another judge, same rule as `matrix.ts`
 *  (see `MatrixSample`) and for the same reason: it is the judge the matrix
 *  shows, hence the one the runs list's mean must account for. A sample with no
 *  living principal on its run (no judge, or all unlinked) carries
 *  `{status: "pending", score: null}`: an absence of judge is no different, for
 *  that mean, from a judge that has not graded yet. */
interface RunListSample {
  run_id: string;
  status: SampleStatus;
  scenario_index: number;
  target_model: string;
  principal: JudgeVerdict;
}

/** The PRINCIPAL judge's verdict for each of these runs, by conversation
 *  identifier — what `overallMean` needs to cost the runs list's mean, in a
 *  handful of requests rather than one per run as `loadLiveRunJudges` called
 *  once per run would do.
 *
 * Filters `run_judges` on `deleted_at` and `is_principal` directly, which makes
 * it the only other exception, along with `loadLiveRunJudges` itself, to the
 * rule the latter documents ("THE function... the only one allowed to filter
 * run_judges on deleted_at"). The exception is deliberate: that function can
 * only query one run at a time, and `loadRuns` must stay a few requests whatever
 * the number of runs — exactly as it already is for the cells (see its comment).
 * The `deleted_at: "is.null"` filter therefore exists in only two places in the
 * whole repository, a few dozen lines apart in this same file: the risk this
 * project warns about — an omission in a third copy, elsewhere — stays
 * contained, there is nowhere else to rewrite it by mistake. */
async function principalVerdictsByRun(
  runIds: string[],
): Promise<Map<string, JudgeVerdict>> {
  if (runIds.length === 0) return new Map();

  const principals = await select<{ id: string }>(RUN_JUDGES, {
    run_id: `in.(${runIds.join(",")})`,
    deleted_at: "is.null",
    is_principal: "eq.true",
    select: "id",
  });
  if (principals.length === 0) return new Map();

  const scores = await select<{
    sample_id: string;
    status: JudgeScore["status"];
    score: number | null;
  }>(JUDGE_SCORES, {
    run_judge_id: `in.(${principals.map((p) => p.id).join(",")})`,
    select: "sample_id,status,score",
  });

  const bySample = new Map<string, JudgeVerdict>();
  for (const row of scores) {
    bySample.set(row.sample_id, { status: row.status, score: row.score });
  }
  return bySample;
}

/** A row of the `eval_run_list` view: a run already aggregated.
 *
 * The names come from the view, not from the table — see the migration
 * `20260907140037_eval_run_list_view.sql` (polaris-supabase repository). */
interface RunListRow {
  id: string;
  created_at: string;
  user_email: string;
  label: string | null;
  status: RunStatus;
  cost_usd: number | null;
  is_public: boolean;
  origin: "local" | "cloud-run";
  launched_via: "ui" | "mcp";
  rubric: RubricLevel[] | null;
  models: EvalModels | null;
  first_scenario_title: string | null;
  sample_total: number;
  sample_done: number;
  sample_running: number;
  sample_errored: number;
  sample_cancelled: number;
  sample_pending: number;
  scenario_count: number;
  min_tries: number;
  max_tries: number;
  /** How many times each grade came up, from the principal judge alone. `null`
   *  when no principal judge has graded yet — distinct from an empty object,
   *  which would assert that it graded and found nothing. */
  principal_scores: Record<string, number> | null;
}

/** The runs as the WEB LIST shows them — one request, one row per run.
 *
 * The aggregation is done in the database by the `eval_run_list` view. Before
 * it, this function brought back EVERY cell of EVERY run, with no filter, then
 * every score row of the principal judge, only to count statuses and make a
 * mean. That held on thirteen runs and stopped holding without warning:
 * PostgREST is capped at 1000 rows (`max_rows` in `config.toml`) and truncates
 * while answering 200. At a dozen cells per run, the cap fell around ninety
 * runs — after which the progress and the means of the oldest would have become
 * false in silence.
 *
 * The cap still exists, but it now counts runs and not cells: a thousand runs
 * instead of ninety, and the remedy that day will be a paginated list, not a
 * mute truncation.
 *
 * The mean is computed here and not in the view: see `meanFromHistogram`.
 *
 * `loadRuns`, just below, stays the source of the MCP search, which does need
 * the whole text of each run. */
export async function loadRunList(): Promise<RunListItem[]> {
  await failStaleRuns();

  const rows = await select<RunListRow>(RUN_LIST, {
    select: "*",
    order: "created_at.desc",
  });

  return rows.map((row) => ({
    run: {
      id: row.id,
      created_at: row.created_at,
      user_email: row.user_email,
      label: row.label,
      status: row.status,
      cost_usd: row.cost_usd,
      is_public: row.is_public,
      origin: row.origin,
      launched_via: row.launched_via,
      rubric: row.rubric ?? [],
      first_scenario_title: row.first_scenario_title,
      scenario_count: row.scenario_count,
      target_count: row.models?.targets.length ?? 0,
    },
    progress: {
      total: row.sample_total,
      done: row.sample_done,
      running: row.sample_running,
      pending: row.sample_pending,
      errored: row.sample_errored,
      cancelled: row.sample_cancelled,
    },
    mean: meanFromHistogram(row.principal_scores, row.rubric),
    repetitions: [row.min_tries, row.max_tries],
  }));
}

/** Every run, from the most recent to the oldest, with its progress.
 *
 * No longer serves the web list — `loadRunList` above takes care of that,
 * without the configuration. Stays the source of the MCP search, which does need
 * all of a run's text.
 *
 * The cells are read in one single request for every run, without their
 * transcripts: the columns brought back are tiny, and one request per run would
 * be far more costly. If the table grew to the point of weighing, an aggregation
 * view in the database would be the remedy — not a pagination of the cells. Same
 * logic for each run's principal verdict, added by `principalVerdictsByRun` in
 * two more requests, never one per run. */
export async function loadRuns(): Promise<RunSummary[]> {
  await failStaleRuns();

  const runs = await select<EvalRun>(RUNS, {
    select: "*",
    // A run set aside is read nowhere any more: neither the list, nor the public
    // page, nor the MCP tools, which all go through here.
    deleted_at: "is.null",
    order: "created_at.desc",
  });
  if (runs.length === 0) return [];

  // Each cell's coordinates on top of the statuses: it is by them that one sees
  // a completed run no longer has the same number of attempts everywhere. Two
  // small extra columns, against the transcripts we do not bring back.
  const samples = await select<
    Pick<EvalSample, "id" | "run_id" | "status" | "scenario_index" | "target_model">
  >(SAMPLES, {
    select: "id,run_id,status,scenario_index,target_model",
  });

  const principals = await principalVerdictsByRun(runs.map((run) => run.id));

  const byRun = new Map<string, RunListSample[]>();
  for (const sample of samples) {
    const enriched: RunListSample = {
      run_id: sample.run_id,
      status: sample.status,
      scenario_index: sample.scenario_index,
      target_model: sample.target_model,
      principal: principals.get(sample.id) ?? { status: "pending", score: null },
    };
    const list = byRun.get(sample.run_id);
    if (list) list.push(enriched);
    else byRun.set(sample.run_id, [enriched]);
  }

  return runs.map((run) => {
    const own = byRun.get(run.id) ?? [];
    return {
      run,
      progress: progressOf(own),
      mean: overallMean(own, run.config.rubric),
      repetitions: repetitionRange(own),
    };
  });
}

/** A run and its cells.
 *
 * `withTranscripts` serves only the opening of a cell, the exports, and the
 * public reading in one go (see `app/shared/[runId]/page.tsx`): refreshing a run
 * under way does not need it.
 *
 * `withJudges` attaches the run's living judges and their verdicts (see
 * `attachJudges`) — on demand, not by default, for the same reason as
 * `withAwarenessMissingFlag` before it, generalised below into
 * `withCatchupMissingFlag`: almost every caller of `loadRun` never uses it. A
 * dozen routes call this function only to check a run exists, and the MCP tools
 * explicitly ask for the light version to stay light. Letting it run by default
 * for them has already dragged a whole matrix of conversations out of the
 * database for a simple note or a move to the bin — the same risk for the
 * judges, which multiply that weight by the number of living judges.
 *
 * `withFullJudgeScores` forces `attachJudges`'s full mode — the verdicts of
 * EVERY living judge, secondaries included, not only the principal's and
 * awareness's — without demanding `withTranscripts`. The two are normally asked
 * for together (see `attachJudges`) because opening a cell or reading a
 * published run in one go needs both at once; the MCP tool `get_run_results`
 * (`app/mcp/route.ts`) is the only caller that needs one without the other —
 * returning each judge's verdict on each cell, never a conversation. Without
 * this separate field, giving it what it needs would have demanded making it
 * carry `withTranscripts` too, and therefore breaking the "no transcripts"
 * promise its description keeps.
 *
 * Throws:
 *   NotFound: if no run carries this identifier.
 */
export async function loadRun(
  runId: string,
  options: {
    withTranscripts?: boolean;
    withSourceCsvFlag?: boolean;
    withJudges?: boolean;
    withCatchupMissingFlag?: boolean;
    withFullJudgeScores?: boolean;
    /** Brings back the results of tools served from the world, for the run's
     *  indicator and its crossing with awareness (see `lib/served.ts`).
     *
     * Outside the default, like the transcripts: almost every run has none, and
     * the runs list must not pay a read per run for a table most often empty. */
    withToolResults?: boolean;
  } = {},
): Promise<RunDetail> {
  await failStaleRuns();

  const runs = await select<EvalRun>(RUNS, {
    id: `eq.${runId}`,
    select: "*",
    deleted_at: "is.null",
    limit: 1,
  });
  // Set aside and non-existent raise the same error: from outside, the two must
  // look alike.
  if (runs.length === 0) throw new NotFound(`Unknown run: ${runId}`);
  const run = runs[0];

  const samples = await select<EvalSample>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: options.withTranscripts ? "*" : SAMPLE_COLUMNS,
    order: "scenario_index.asc,target_model.asc,repetition.asc",
  });
  for (const sample of samples) {
    sample.messages ??= [];
    sample.usage ??= {};
  }

  // `sourceCsv` brings back the whole column — possibly several hundred
  // kilobytes — only to keep a boolean of it. `loadPublicRun` has nobody to show
  // it to: the download button only exists on the private page. Sparing it that
  // read is the sole purpose of `withSourceCsvFlag`.
  const sourceCsvAvailable =
    options.withSourceCsvFlag === false ? false : Boolean(await sourceCsv(runId));

  return {
    run,
    samples,
    progress: progressOf(samples),
    source_csv_available: sourceCsvAvailable,
    catchup_missing: await catchupMissingTotal(run, options),
    judges: options.withJudges
      ? await attachJudges(
          runId,
          Boolean(options.withTranscripts) || Boolean(options.withFullJudgeScores),
        )
      : undefined,
    tool_results: options.withToolResults
      ? await select<ToolResultRow>(TOOL_RESULTS, {
          run_id: `eq.${runId}`,
            // `check_error` on top, since the indicator distinguishes "never
            // attempted" from "attempted without succeeding" — see `lib/served.ts`.
          select: "scenario_index,tool_name,arguments,faithful,fault,check_error",
          order: "scenario_index.asc,tool_name.asc",
        })
      : undefined,
  };
}

/** A run's living judges, with their verdict on each conversation — what
 *  `RunDetail.judges` carries to the screen (see `RunJudgeView`, `types.ts`).
 *  Goes through `loadLiveRunJudges`, like all code that needs to know which
 *  judges are alive on a run: no further `deleted_at` filter is written here.
 *
 * `fullScores` decides this join's weight, on the same principle as
 * `SAMPLE_COLUMNS`/`withTranscripts` above: the verdicts of N judges on every
 * conversation of a run also weigh — several judges × several dozen
 * conversations × a justification that can run to several sentences. `false`
 * (the default, on every three-second refresh while a run is going) brings back
 * the grades of the PRINCIPAL judge and of the awareness link if there is one
 * only — the two the matrix and its indicator show without anything being
 * unfolded. `true` also brings back the secondary judges': asked for by
 * `loadRun` as soon as `withTranscripts` is (opening a cell, or reading a
 * published run in one go — see `AttemptView`, `components/RunRead.tsx`) OR as
 * soon as `withFullJudgeScores` is — see its docstring on `loadRun` for the only
 * caller that asks for one without the other: returning every judge without ever
 * loading a conversation.
 *
 * Every living judge always appears in the returned array — including without
 * `fullScores`, where a secondary judge then carries `scores: {}` — so that
 * "Show N other judges" counts right without having to load their grades. */
async function attachJudges(
  runId: string,
  fullScores: boolean,
): Promise<RunJudgeView[]> {
  const live = await loadLiveRunJudges(runId);
  if (live.length === 0) return [];

  const wanted = fullScores
    ? live
    : live.filter(
        (link) => link.is_principal || link.system_type === AWAKE_TYPE,
      );

  const rows =
    wanted.length === 0
      ? []
      : await select<{
          run_judge_id: string;
          sample_id: string;
          status: JudgeScore["status"];
          score: number | null;
          justification: string;
          error: string | null;
        }>(JUDGE_SCORES, {
          run_judge_id: `in.(${wanted.map((link) => link.id).join(",")})`,
          select: "run_judge_id,sample_id,status,score,justification,error",
        });

  const byJudge = new Map<string, Record<string, JudgeVerdictEntry>>();
  for (const row of rows) {
    const scores = byJudge.get(row.run_judge_id) ?? {};
    scores[row.sample_id] = {
      status: row.status,
      score: row.score,
      justification: row.justification,
      error: row.error,
    };
    byJudge.set(row.run_judge_id, scores);
  }

  return live.map((link) => ({
    run_judge_id: link.id,
    judge: link.judge,
    is_principal: link.is_principal,
    system_type: link.system_type,
    scores: byJudge.get(link.id) ?? {},
  }));
}

/** How many rows of `judge_scores`, pending OR in error on a living link, bear
 *  on a conversation already finished — hence what the next catch-up will
 *  really fill in. Generalises the old `awarenessMissingTotal` (until the
 *  multiple judges, only the awareness link could carry pending rows after the
 *  fact) to any living judge — see the design, section « Le rattrapage,
 *  généralisé ».
 *
 * `pending OR in error`: the catch-up takes both back, not only the rows never
 * judged — see `catchup_dataset`, `backend/playground/batch_job.py`, which
 * filters the same way (`status = "in.(pending,error)"`). Counting one without
 * the other would make the button and the engine it triggers say two different
 * things — already happened once on this project.
 *
 * On demand, never by default, same reason as the old version: almost every
 * caller of `loadRun` never uses it.
 *
 * THE TRAP, and it has already bitten this project once on awareness: a row
 * pending or in error on a living link is not necessarily catchable up — its
 * conversation must ALSO be finished (`status = 'done'`). The engine
 * (`catchup_dataset`, `backend/playground/batch_job.py`) applies those three
 * conditions together and never catches up a conversation that is not; a count
 * ignoring the third would announce work the engine will never do, and the
 * button would stay lit forever. The third condition is checked here by
 * `catchupCandidateCount` (`catchup.ts`), which documents that trap in detail —
 * never recounted by hand elsewhere: the route that starts a catch-up
 * (`.../catchup/route.ts`) rereads this same field rather than redoing the
 * computation on its side, which makes this function the only place in the
 * repository that decides "how much is left to catch up".
 *
 * Two already known cases remain: the run is still going, in which case the
 * number is useless since the button that reads it demands `!running` —
 * announcing it as zero avoids a read on every three-second refresh; no living
 * link returns zero too, for want of anything that could be missing. */
async function catchupMissingTotal(
  run: EvalRun,
  options: { withCatchupMissingFlag?: boolean },
): Promise<number> {
  if (!options.withCatchupMissingFlag) return 0;
  if (run.status === "triggered" || run.status === "running") return 0;

  const live = await loadLiveRunJudges(run.id);
  if (live.length === 0) return 0;

  const pending = await select<{ sample_id: string }>(JUDGE_SCORES, {
    run_id: `eq.${run.id}`,
    run_judge_id: `in.(${live.map((link) => link.id).join(",")})`,
    // Pending AND in error: the catch-up takes both back (see the docstring
    // above) — same filter as `catchup_dataset` on the engine's side.
    status: "in.(pending,error)",
    select: "sample_id",
  });
  if (pending.length === 0) return 0;

  const sampleIds = [...new Set(pending.map((row) => row.sample_id))];
  const done = await select<{ id: string }>(SAMPLES, {
    run_id: `eq.${run.id}`,
    id: `in.(${sampleIds.join(",")})`,
    status: "eq.done",
    select: "id",
  });

  return catchupCandidateCount(pending, new Set(done.map((row) => row.id)));
}

/** The CSV uploaded at launch, or null if there was none.
 *
 * Read apart from the run: the column can weigh several hundred kilobytes, and
 * no other read needs it. */
export async function sourceCsv(runId: string): Promise<string | null> {
  const rows = await select<{ source_csv: string | null }>(RUNS, {
    id: `eq.${runId}`,
    select: "source_csv",
    limit: 1,
  });
  return rows[0]?.source_csv ?? null;
}

/** Creates a run and its whole matrix, pending.
 *
 * The cells are written at launch, not by the job: it is what makes the progress
 * exact before the job even starts, and what allows showing the greyed matrix
 * from the first second.
 *
 * `launchedVia` is `'ui'` by default: the callers predating this column — the
 * form, the route that launches a draft — have nothing to change to keep writing
 * what they already wrote. Only the MCP tool `launch_draft` passes `'mcp'`, the
 * only value `mcp-budget.ts`'s budget counts. */
export async function createRun(
  config: EvalRunConfig,
  userEmail: string,
  csvText: string | null,
  draftId: string | null = null,
  launchedVia: "ui" | "mcp" = "ui",
): Promise<EvalRun> {
  const total =
    config.scenarios.length * config.models.targets.length * config.repetitions;

  const created = await insert<EvalRun>(
    RUNS,
    {
      user_email: userEmail,
      label: config.label?.trim() || null,
      config,
      notes: config.notes ?? "",
      source_csv: csvText,
      total_samples: total,
      // Recomputed here and not taken from the browser: the recorded quote must
      // be the one this code produces, not the one a client claims to have seen.
      // Without that, the comparison afterwards would measure nothing any more.
      // The assumed length does come from the client — but through the config,
      // which is validated, and not through a parameter on the side.
      estimate: estimateCost(config),
      // Where it comes from, when it comes from a draft. Carried by the run and
      // not by the draft: relaunching the same draft is expected, and a single
      // cell on the other side would overwrite the previous run.
      draft_id: draftId,
      launched_via: launchedVia,
    },
    { returning: true },
  );
  const run = created[0];

  // The temperature is laid here, not computed by the job: a run completed later
  // will have its new repetitions spread out apart, and recomputing from
  // `config.repetitions` would then rewrite the temperature of the cells already
  // paid for.
  //
  // `returning: true`: the cells' identifiers are needed just below to lay the
  // rows of `judge_scores`, which aim at a conversation by its `id` and not by
  // its quadruplet.
  const samples = await insert<{ id: string }>(
    SAMPLES,
    cellsForRun(config).map((cell) => ({ run_id: run.id, ...cell })),
    { returning: true },
  );

  // The run's judges, and all their pending score rows — same gesture as the
  // matrix above: nothing is invented later, everything already exists, pending.
  // Three inserts in that precise order because each of the following tables
  // carries a foreign key to the previous one: judges before run_judges,
  // run_judges (and the samples, already in the database) before judge_scores.
  const { judges, runJudges, judgeScores } = judgesForLaunch(
    config,
    run.id,
    userEmail,
    samples.map((sample) => sample.id),
  );
  await insert(JUDGES, judges);
  await insert(RUN_JUDGES, runJudges);
  await insert(JUDGE_SCORES, judgeScores);

  return run;
}

// --- the judges ------------------------------------------------------------

/** A living link, with the judge it aims at already resolved — what a caller
 *  needs to know to show, export, or grade in that judge's name, without ever
 *  rereading `judges` beside it. */
export interface LiveRunJudge extends RunJudge {
  judge: Judge;
}

/** THE function that loads a run's judges — the only one allowed to filter
 *  `run_judges` on `deleted_at`, with the exception below. All code that needs
 *  to know which judges are alive on a run — the screen, an export, an MCP tool,
 *  the quote, the configuration returned to an agent — calls this one; nothing
 *  else in this repository has the right to reread `run_judges` through a direct
 *  `select`.
 *
 * Copied into two reads, this filter would be forgotten in a third: this project
 * has already produced two real examples of that omission — a count that weighed
 * down twelve routes nobody had seen, a form that ignored a field for a whole
 * plan (see the design,
 * docs/superpowers/specs/2026-09-06-juges-multiples.md). An unlinked judge must
 * never come back anywhere; the only way to guarantee it is that there be one
 * single place to check. All code that needs to know which judges are alive on a
 * run goes through it rather than rereading `run_judges` its own way —
 * `unlinkJudge` and `designatePrincipal`, just below, are no longer part of it:
 * they now delegate that same filter to the RPC functions that carry their
 * gesture in the database, in one transaction (see their comments).
 *
 * THE ONE exception, deliberate: `principalVerdictsByRun`, further down in this
 * same file, filters `run_judges` on `deleted_at` too, but in bulk for several
 * runs at once — which this function, taking a single `runId`, cannot do without
 * becoming one call per run in `loadRuns`. The two copies of the filter live a
 * few dozen lines apart, in this same file: the risk of omission this comment
 * describes stays contained, for want of a third place to rewrite it by
 * mistake. */
export async function loadLiveRunJudges(runId: string): Promise<LiveRunJudge[]> {
  const links = await select<RunJudge>(RUN_JUDGES, {
    run_id: `eq.${runId}`,
    // The only place in the repository that filters on deleted_at for this table.
    deleted_at: "is.null",
    select: "*",
    order: "created_at.asc",
  });
  if (links.length === 0) return [];

  const judgeIds = [...new Set(links.map((link) => link.judge_id))];
  const judges = await select<Judge>(JUDGES, {
    id: `in.(${judgeIds.join(",")})`,
    select: "*",
  });
  const byId = new Map(judges.map((judge) => [judge.id, judge]));

  return links.map((link) => {
    const judge = byId.get(link.judge_id);
    if (!judge) {
        // Should never happen: the composite foreign key `run_judges_judge_fk`
        // guarantees that a `judge_id` of `run_judges` always exists in
        // `judges`. A database that violates its own constraint deserves a loud
        // failure, not a link with no judge.
      throw new SupabaseError(
        `run_judges ${link.id} references unknown judge ${link.judge_id}`,
      );
    }
    return { ...link, judge };
  });
}

/** The judge and its verdict, for a living link of a run — what
 *  `judgeVerdictsForSample`, just below, returns for EACH one. */
export interface SampleJudgeVerdict {
  judge: Judge;
  is_principal: boolean;
  system_type: JudgeSystemTypeColumn;
  verdict: JudgeVerdictEntry;
}

/** Each living judge of a run's verdict on ONE chosen conversation — what the
 *  MCP tool `get_run_trajectory` needs to show each one's verdict on a single
 *  cell, without loading the whole run as `attachJudges` would: one row of
 *  `judge_scores` per living judge, never one per conversation of the whole run.
 *  Goes through `loadLiveRunJudges`, like all code that needs to know which
 *  judges are alive on a run — an unlinked judge must never appear here either.
 *
 * A link with no row for this `sampleId` — should not happen, see the design,
 * section « Les lignes de score sont créées d'avance » — returns its default
 * pending state rather than disappearing from the list: every living judge
 * always appears, exactly as `attachJudges` already does for a whole run. */
export async function judgeVerdictsForSample(
  runId: string,
  sampleId: string,
): Promise<SampleJudgeVerdict[]> {
  const live = await loadLiveRunJudges(runId);
  if (live.length === 0) return [];

  const rows = await select<{
    run_judge_id: string;
    status: JudgeScore["status"];
    score: number | null;
    justification: string;
    error: string | null;
  }>(JUDGE_SCORES, {
    run_judge_id: `in.(${live.map((link) => link.id).join(",")})`,
    sample_id: `eq.${sampleId}`,
    select: "run_judge_id,status,score,justification,error",
  });
  const byJudge = new Map(rows.map((row) => [row.run_judge_id, row]));

  return live.map((link) => ({
    judge: link.judge,
    is_principal: link.is_principal,
    system_type: link.system_type,
    verdict: byJudge.get(link.id) ?? {
      status: "pending",
      score: null,
      justification: "",
      error: null,
    },
  }));
}

/** Translates a refusal from `run_judges_unlink` or
 *  `run_judges_transfer_principal` — or from the deferred trigger that covers
 *  them — into the error those two functions already expose, with a readable
 *  English message. Any error that is not a recognised refusal from those
 *  functions (a `SupabaseError` with no match, or an error of another kind)
 *  passes through as it stands: better an imperfect message than swallowing one
 *  we could not read.
 *
 * The classification itself — recognising the French text Postgres returns —
 * lives in `run-judges-refusal.ts`, apart from this file, so as to stay testable
 * without Supabase (see its comment). This function does no more than choose,
 * according to the classification, which of this file's error classes to raise.
 */
function throwRunJudgesRefusal(error: unknown): never {
  if (error instanceof SupabaseError) {
    const refusal = classifyRunJudgesRefusal(error.message);
    if (refusal) {
      if (refusal.kind === "principal_needs_replacement") {
        throw new PrincipalRequiresReplacement(refusal.message);
      }
      if (refusal.kind === "not_found") throw new NotFound(refusal.message);
      throw new Error(refusal.message);
    }
  }
  throw error;
}

/** Unlinks a judge from a run: marks its link deleted, without touching the
 *  judge — a configuration that can serve again — or `judge_scores`, whose rows
 *  stay in the database, unchanged: the deletion is an `UPDATE` that lays
 *  `deleted_at`, never a `DELETE`, and nothing ever fires the `ON DELETE`
 *  cascade the foreign key from `judge_scores` to this table carries — see the
 *  comment on `RunJudge.deleted_at` (`types.ts`) and that of the migration of
 *  the same name which fixed it after the fact. It is the discipline of
 *  reading — filtering on `deleted_at is null`, once only, in
 *  `loadLiveRunJudges` — that carries the whole weight of no longer showing
 *  them.
 *
 * Goes through the RPC function `run_judges_unlink`, which unlinks and — if
 * `replacementRunJudgeId` is supplied and `runJudgeId` carries the principal —
 * transfers the principal to the replacement, in one single transaction.
 *
 * **Why a function in the database, and not two writes**: PostgREST makes one
 * round trip per write, hence one transaction per write. Laying `deleted_at` on
 * the principal as a write separate from the one that would designate its
 * replacement would leave, once the first alone had committed, a run with no
 * principal at all — which the deferred trigger
 * `run_judges_require_principal_trg` now refuses at its own commit (see
 * `PrincipalRequiresReplacement`). Two writes would therefore become again a
 * one-way trip that always fails as soon as other judges are still alive on the
 * run. See .superpowers/sdd/fix-principal-rpc-report.md for the exact SQL of the
 * two RPC functions and what each refusal means.
 *
 * Without `replacementRunJudgeId`: unlinking a link that is not principal asks
 * no question. Unlinking the run's last living link is allowed too — a run with
 * no judge at all is a valid state. Unlinking the principal while other living
 * links remain, with no replacement, is refused by the deferred trigger cited
 * above; it is no longer this file that recounts the links to anticipate it.
 *
 * Throws:
 *   NotFound: if `runJudgeId` (or the replacement supplied) designates no link
 *     of this run, or designates one already unlinked.
 *   PrincipalRequiresReplacement: if `runJudgeId` is the run's living principal,
 *     no valid replacement is supplied, and other living links remain on that
 *     run.
 */
export async function unlinkJudge(
  runId: string,
  runJudgeId: string,
  replacementRunJudgeId: string | null = null,
): Promise<void> {
  try {
    await rpc("run_judges_unlink", {
      p_run_id: runId,
      p_run_judge_id: runJudgeId,
      p_replacement_run_judge_id: replacementRunJudgeId,
    });
  } catch (error) {
    throwRunJudgesRefusal(error);
  }
}

/** Designates a run's principal: the one the matrix shows.
 *
 * Goes through the RPC function `run_judges_transfer_principal`, which takes
 * `is_principal` away from the former living principal, if there is one, and
 * lays it on `runJudgeId` — in that order, never the reverse — in one single
 * transaction. The order matters for the same reason as before: laying the new
 * principal before removing the old would let two living principal links for the
 * same run coexist for the length of a round trip, which the partial unique
 * index `run_judges_single_principal_idx` refuses. See `unlinkJudge`'s comment
 * for why it is now the RPC function, and not this file in two writes, that
 * holds that order.
 *
 * Idempotent: designating a judge that is already principal rewrites nothing —
 * it is the RPC function itself that guarantees it, not a check here.
 *
 * Throws:
 *   NotFound: if `runJudgeId` designates no living link of this run.
 */
export async function designatePrincipal(runId: string, runJudgeId: string): Promise<void> {
  try {
    await rpc("run_judges_transfer_principal", {
      p_run_id: runId,
      p_run_judge_id: runJudgeId,
    });
  } catch (error) {
    throwRunJudgesRefusal(error);
  }
}

/** What a caller has launched through MCP over the hour just past: the number of
 *  launches, and their summed quote — never what a run ended up really costing,
 *  which only exists once it has finished and which an agent can therefore never
 *  foresee before calling.
 *
 * Counted on `mcp_launches`, not on `eval_runs`: an extension writes on an
 * existing run, which may have been created by a human or may already carry the
 * launches of several different agents — `eval_runs.launched_via` no longer
 * answers "how much has that caller spent", only "was this run started by an
 * agent". `mcp_launches` carries one row per launch and not per run, which makes
 * an extension countable exactly like a fresh run. Filtered on `user_email` and
 * `created_at`: the read the index laid with the table covers.
 *
 * The count serves the profile page, the amount also serves the budget decision
 * of `app/mcp/route.ts` — see `mcpSpendLastHour`, which keeps only the second so
 * as not to change the expected shape where the count is of no use. */
export async function mcpActivityLastHour(
  userEmail: string,
): Promise<{ count: number; usd: number }> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const launches = await select<{ quoted_usd: number }>(MCP_LAUNCHES, {
    select: "quoted_usd",
    user_email: `eq.${userEmail}`,
    created_at: `gte.${since}`,
  });
  return {
    count: launches.length,
    usd: launches.reduce((total, launch) => total + launch.quoted_usd, 0),
  };
}

/** The only figure the budget decision needs — see `mcpActivityLastHour` for
 *  what is counted and why. */
export async function mcpSpendLastHour(userEmail: string): Promise<number> {
  return (await mcpActivityLastHour(userEmail)).usd;
}

/** Records a launch that succeeded through MCP, `run` as much as `extend`.
 *
 * To be called after the job has really started, never before: a row for a
 * launch that did not happen would consume budget for nothing. `quotedUsd` is
 * the quote that served to decide the launch — the one checked against the two
 * caps — and not a cost recomputed afterwards: it is the one that counts, see
 * `mcpSpendLastHour`. */
export async function recordLaunch(
  userEmail: string,
  runId: string,
  kind: "run" | "extend",
  quotedUsd: number,
): Promise<void> {
  await insert(MCP_LAUNCHES, {
    user_email: userEmail,
    run_id: runId,
    kind,
    quoted_usd: quotedUsd,
  });
}

/** Opens a catch-up pass on a run.
 *
 * Puts NOTHING back to pending, unlike `extendRun`: the rows to fill already
 * exist, `pending`, since the launch, an extension, or the addition of a judge
 * (`addJudge`, just below) — which this catch-up comes to fill in, not to redo.
 * Only the run goes back to `running`, so that the screen shows something is
 * happening.
 *
 * Replaces the old `resetForRejudge` and the old `startAwarenessPass`: the first
 * overwrote the principal's verdict before redoing it — "re-judging" no longer
 * exists, see `addJudge` for what that gesture has become — and the second only
 * caught up the awareness link. One single mode in the job (`catchup`, see
 * `run_batch_job`, `backend/playground/batch_job.py`) for both, generalised to
 * any judge — see `.superpowers/sdd/task-9-report.md`. */
export async function startCatchupPass(runId: string): Promise<void> {
  await update(
    RUNS,
    { status: "running", error: null, started_at: NOW, finished_at: null },
    { id: `eq.${runId}` },
  );
}

/** Adds a secondary judge to an existing run: the judge, its link — never
 *  principal — and a pending row of `judge_scores` on EVERY conversation already
 *  laid down for this run, played or not.
 *
 * This is what "re-judging" has become since the multiple judges: the
 * principal's verdict is no longer overwritten, one more judge is added, and the
 * old one stays to compare — see `.superpowers/sdd/task-9-report.md`.
 *
 * Without these `judge_scores` rows, `write_judge_score` (the engine,
 * `supabase_store.py`) would find nothing to update: it only does a targeted
 * UPDATE on (`run_judge_id`, `sample_id`), never an INSERT — see the comment on
 * `judgeScoresForSamples`. That flaw has already existed once, on run extension
 * (`extendRun`), before being fixed; it must not repeat here. `startCatchupPass`,
 * above, is what then fills those rows for the conversations already finished —
 * see `catchupMissingTotal` for how what is left to catch up is counted.
 *
 * Always secondary (`is_principal: false`): designating a principal judge at its
 * creation would confuse two distinct gestures, see `designatePrincipal` for the
 * second, separate and explicit one.
 *
 * `createdBy` comes from the caller's session, never from the request body —
 * same rule as everywhere else in this file.
 *
 * Throws:
 *   NotFound: if no run carries this identifier.
 */
export async function addJudge(
  runId: string,
  spec: JudgeSpec,
  createdBy: string,
): Promise<{ runJudgeId: string }> {
  const runs = await select<{ id: string; config: EvalRunConfig }>(RUNS, {
    id: `eq.${runId}`,
    select: "id,config",
    deleted_at: "is.null",
    limit: 1,
  });
  if (runs.length === 0) throw new NotFound(`Unknown run: ${runId}`);
  const run = runs[0];

  // Every conversation already laid down, finished or not: a cell still
  // `pending`/`running` will receive its score row like the others — see the
  // docstring for why a pending row must exist in advance, whatever the state of
  // the cell it aims at.
  const samples = await select<{ id: string }>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: "id",
  });

  const judge = judgeRowFromSpec(spec, run.config.models.judge, createdBy);
  const runJudgeId = randomUUID();

  await insert(JUDGES, judge);
  await insert(RUN_JUDGES, {
    id: runJudgeId,
    run_id: runId,
    judge_id: judge.id,
    system_type: judge.system_type,
    is_principal: false,
  });
  if (samples.length > 0) {
    await insert(
      JUDGE_SCORES,
      judgeScoresForSamples(runId, [runJudgeId], samples.map((sample) => sample.id)),
    );
  }

  return { runJudgeId };
}

/** Asks for the stop: the job reads it before each cell and ends itself.
 *
 * Only the run is marked. The remaining cells are moved to `cancelled` by the
 * job, not here — it is the job that knows which ones it has not done, and doing
 * it on both sides would produce two truths on the same row. */
export async function cancelRun(runId: string): Promise<void> {
  await update(RUNS, { status: "cancelled" }, { id: `eq.${runId}` });
}

/** Renames a run.
 *
 * `null` restores the default title — that of the first scenario, then the
 * identifier, as the display already does. It is what an emptied field must
 * mean: "I have no name for this run", and not "its name is the empty string",
 * which would leave a row with nothing to click on.
 *
 * Writes only the `label` column, never `config.label`: the configuration is the
 * photograph of what was asked at launch, and an extension rewrites it quite
 * enough already. The displayed title comes from the column — see `RunListRun`. */
export async function saveLabel(runId: string, label: string | null): Promise<void> {
  await update(RUNS, { label }, { id: `eq.${runId}` });
}

export async function saveNotes(runId: string, notes: string): Promise<void> {
  await update(RUNS, { notes }, { id: `eq.${runId}` });
}

/** Written afterwards, never carried by `config`: see `EvalRun.analysis`. */
export async function saveAnalysis(runId: string, analysis: string): Promise<void> {
  await update(RUNS, { analysis }, { id: `eq.${runId}` });
}

export async function recordStart(
  runId: string,
  started: { execution: string; origin: string },
): Promise<void> {
  await update(RUNS, started, { id: `eq.${runId}` });
}

/** Marks a run as stillborn: the job could not be started.
 *
 * Without this, it would stay `pending` indefinitely — until the expiry function
 * picked it up two hours later, with a message speaking of a job that had
 * vanished rather than of a job never launched. */
export async function failToStart(runId: string, reason: string): Promise<void> {
  await update(
    RUNS,
    { status: "error", error: reason, finished_at: NOW },
    { id: `eq.${runId}` },
  );
  await update(
    SAMPLES,
    { status: "error", error: reason, finished_at: NOW },
    { run_id: `eq.${runId}`, status: "in.(pending,running)" },
  );
}

/** Puts the cells in error back to be done, within the same run.
 *
 * The same run, and not a new one: a provider outage on fifteen cells is not
 * another experiment, and the matrix must close back up where it was holed. The
 * partial transcripts are erased — what failed mid-conversation must not mix
 * with the new attempt.
 *
 * Never touches `judge_scores`, unlike the deepening in `extendRun`: a cell in
 * `error` failed at *execution*, before any judge could see it — see the
 * distinction carried by `EvalSample.error` in `types.ts`. Its score rows are
 * therefore still waiting as `"pending"`, laid down at launch, never reached;
 * there is nothing to put back there.
 *
 * Returns the number of cells put back into play, zero if there were none. */
export async function retryFailed(runId: string): Promise<number> {
  const count = await failedCellCount(runId);
  if (count === 0) return 0;

  await update(
    SAMPLES,
    {
      status: "pending",
      messages: [],
      error: null,
      started_at: null,
      finished_at: null,
    },
    { run_id: `eq.${runId}`, status: "eq.error" },
  );
  await update(
    RUNS,
    { status: "triggered", error: null, finished_at: null },
    { id: `eq.${runId}` },
  );
  return count;
}

/** How many cells of this run are in error — changing nothing.
 *
 * Separated from `retryFailed` (CRITICAL 1): the route must know whether there
 * is anything to retry *before* deciding whether the run's configuration still
 * allows it, and `retryFailed` mutates as soon as it returns a non-zero count —
 * calling it only to count would already have put the cells back to `pending`
 * and the run back to `triggered` before even knowing whether the job could
 * start, leaving a run stuck at `triggered` if the refusal came afterwards. */
export async function failedCellCount(runId: string): Promise<number> {
  const failed = await select<{ id: string }>(SAMPLES, {
    select: "id",
    run_id: `eq.${runId}`,
    status: "eq.error",
  });
  return failed.length;
}

/** What an extension adds and costs, reduced to what `extendRun` and the MCP
 *  route make of it — see `planExtension` just below. */
export interface ExtensionPlan {
  run: EvalRun;
  /** Every scenario of the run after the extension, old and fresh — to rewrite
   *  `config.scenarios`. */
  scenarios: EvalScenario[];
  /** The run's target models after the extension — to rewrite
   *  `config.models.targets`. */
  targets: string[];
  temperature: TemperatureSpec | null | undefined;
  /** The run's tools after the extension — to rewrite `config.tools`. */
  tools: ToolSpec[];
  /** The fresh cells to write, already numbered on what exists in the database.
   *  Empty when the extension adds nothing — a deepening alone, or nothing at
   *  all. */
  cases: NewCell[];
  /** How many already played attempts it puts back into play to be deepened. */
  continued: number;
  /** The identifiers of those same attempts — `continued` is only their count.
   *  `extendRun` needs them to put back to pending, on `judge_scores`, the
   *  verdict of EVERY living judge of the run on those conversations: a verdict
   *  bore on a shorter conversation, and says nothing of the one to come (see
   *  `extendRun`'s comment). Empty when `continued` is zero. */
  continuedSampleIds: string[];
  /** The judges to lay on this run. Combines with nothing else — see
   *  `extendProblem`, which refuses it, and `ExtendRequest.new_judges` for why.
   *  Empty when the extension lays none. */
  newJudges: JudgeSpec[];
  /** `null` when `cases` is empty, `continued` is zero and no judge is laid:
   *  there is then nothing to cost. */
  estimate: CostEstimate | null;
}

/** What an extension is going to add and cost, read without writing anything.
 *
 * Serves two callers that must land on the same figure: `extendRun`, which
 * inserts `cases` as they stand and no longer has to rebuild them, and the MCP
 * route, which reads `estimate` to decide whether the quote passes under the two
 * caps *before* writing anything at all. A quote computed by each on its own
 * side had already diverged by a factor of three — this file's reason for being
 * lies in `extend-estimate.ts` — and the same drift was watching the very shape
 * of the extension, down to the cells themselves: counting them by a product
 * beside `cellsForExtension`, rather than calling it, would have reopened exactly
 * that risk the day one of the two forms changed without the other. There is
 * therefore only one place that builds them.
 *
 * Makes no write.
 *
 * Throws:
 *   NotFound: if no run carries this identifier.
 */
export async function planExtension(
  runId: string,
  request: ExtendRequest,
): Promise<ExtensionPlan> {
  const runs = await select<EvalRun>(RUNS, { select: "*", id: `eq.${runId}` });
  const run = runs[0];
  if (!run) throw new NotFound(runId);

  const config = run.config;

  // The run's tools after this extension. `extendProblem` has already refused a
  // name that would redefine one: adding has no effect on the past.
  const toolsBefore = config.tools ?? [];
  const allTools = [...toolsBefore, ...(request.new_tools ?? [])];

  // A scenario with no `tools` key means "all the run's", resolved on reading
  // and not frozen at execution. Adding a tool would therefore give it to it
  // retroactively — not in the cells already played, which are done, but in any
  // re-execution of that scenario. When that is not wanted, the tools that
  // existed are written out in black and white: the same behaviour, made
  // explicit at the moment it was about to stop being true.
  const freeze =
    (request.new_tools ?? []).length > 0 &&
    request.new_tools_for_existing === false;
  const existing = freeze
    ? config.scenarios.map((scenario) =>
        scenario.tools == null
          ? { ...scenario, tools: toolsBefore.map((tool) => tool.name) }
          : scenario,
      )
    : config.scenarios;

  const scenarios = [...existing, ...request.new_scenarios];
  const freshIndices = request.new_scenarios.map(
    (_, offset) => existing.length + offset,
  );
  const indices = [...new Set([...request.scenario_indices, ...freshIndices])].sort(
    (a, b) => a - b,
  );
  const targets = [...new Set([...config.models.targets, ...request.targets])];
  const temperature =
    request.temperature === undefined ? config.temperature : request.temperature;

  // Where each pair stands: the repetitions added carry on after the last one,
  // without which they would collide with the existing ones and the uniqueness
  // constraint would refuse the insertion.
  const existingCells = await select<{
    scenario_index: number;
    target_model: string;
    repetition: number;
  }>(SAMPLES, {
    select: "scenario_index,target_model,repetition",
    run_id: `eq.${runId}`,
  });
  const lastRepetition = new Map<string, number>();
  for (const cell of existingCells) {
    const key = coupleKey(cell.scenario_index, cell.target_model);
    lastRepetition.set(key, Math.max(lastRepetition.get(key) ?? -1, cell.repetition));
  }

  const cases = cellsForExtension(
    scenarios,
    indices,
    request.targets,
    request.repetitions,
    temperature,
    lastRepetition,
  );

  // The attempts kept for the deepening: graded by the PRINCIPAL judge — never
  // another judge of the run — and, when a list of grades is given, among those.
  // Same choice as for the matrix and the deepening count (`matrix.ts`,
  // `deepen-counts.ts`): it is already the judge the matrix shows, and "the
  // attempts graded 0 or 1" no longer has a single referent as soon as a run
  // carries several judges — one had to be chosen, and it is the one already
  // chosen elsewhere for the same question. `score=in.(...)` already excludes the
  // attempts with no grade, a list of numbers never holding `null`;
  // `not.is.null` does that work for "all". A run with no living principal (no
  // judge, or all unlinked) has nothing to deepen: `principal` is then
  // `undefined`.
  const liveJudges = await loadLiveRunJudges(runId);
  const principal = liveJudges.find((judge) => judge.is_principal);
  const toDeepen =
    request.deepen === undefined || !principal
      ? []
      : await deepenCandidates(runId, principal.id, request.deepen);
  // An extension that only deepens existing attempts adds no fresh cell; that
  // does not mean there is nothing to do.
  const continuedSampleIds = toDeepen.map((sample) => sample.id);
  const continued = toDeepen.length;
  const freshJudges = request.new_judges ?? [];
  if (cases.length === 0 && continued === 0 && freshJudges.length === 0) {
    return {
      run,
      scenarios,
      targets,
      temperature,
      tools: allTools,
      cases,
      continued: 0,
      continuedSampleIds: [],
      newJudges: [],
      estimate: null,
    };
  }

  // What the run knows of itself. Five columns only: the transcripts weigh
  // hundreds of kilobytes and the measurement does not need them, `usage`
  // carrying the tokens really billed and `turns_done` the depth at which each
  // cell spent them.
  const playedCells = await select<MeasurableCell>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: "scenario_index,target_model,status,turns_done,usage",
  });
  for (const cell of playedCells) cell.usage ??= {};
  const measured = measureRun(playedCells, config.models, config.turns);

  // The scenarios really added, each with its index in the run: an offset would
  // give one scenario another's measured length, in silence.
  const kept = indices
    .filter((index) => Boolean(scenarios[index]))
    .map((index) => ({ index, scenario: scenarios[index] }));

  // The computation itself is the panel's, to the letter: `estimateExtension` is
  // called here, and by the panel on the client side. Two separate computations
  // had diverged by a factor of three without anything saying so.
  //
  // `config` stays the photograph of the launch — it may name a judge unlinked
  // since, keep quiet about a judge added afterwards, or promise an awareness
  // check that no longer has a living link on a run migrated from the old world.
  // Yet it is the LIVING judges the extension is going to have judge: costing on
  // `config` underbills a judge added, overbills a judge unlinked, and invents a
  // vanished awareness check. `withLiveJudges` already repairs that gap for the
  // reading of a configuration (`get_run_config`) and for duplication
  // (`app/page.tsx`) — same correction here, the quote being what an MCP tool
  // sets against the calling agent's spending caps: an underestimated quote would
  // let it exceed its own.
  // `withLiveJudges` repairs the judges; the world has the same problem for the
  // estimate that follows — `config.models.world` is still `null` when it is
  // precisely this extension that introduces the first served tool, and the price
  // of the served calls would then fall back on the empty model. Resolved once,
  // as `world` is elsewhere — see `resolvedWorld`. Merged onto `.models` already
  // repaired by `withLiveJudges`, not onto the launch's: without that, a living
  // judge different from the launch's would become that of back then again.
  const withJudges = withLiveJudges(config, liveJudges);
  const liveConfig = {
    ...withJudges,
    models: { ...withJudges.models, world: resolvedWorld(withJudges, request) },
  };

  // Laying a judge plays no conversation: it rereads those already finished. Its
  // quote therefore has nothing to do with that of an extension that adds cells,
  // and `extendProblem` forbids mixing the two — which is what allows choosing
  // one or the other computation here without adding them together.
  if (freshJudges.length > 0) {
    const finished = playedCells.filter((cell) => cell.status === "done").length;
    const perJudge = freshJudges.map((spec) =>
      estimateJudgeAdditionCost(liveConfig, spec, finished),
    );
    return {
      run,
      scenarios,
      targets,
      temperature,
      tools: allTools,
      cases: [],
      continued: 0,
      continuedSampleIds: [],
      newJudges: freshJudges,
      estimate: perJudge.reduce((total, part) => addEstimates(total, part)),
    };
  }

  const estimate = estimateExtension(
    liveConfig,
    {
      scenarios: kept,
      targets: request.targets,
      repetitions: request.repetitions,
        // The depth asked for, not the one before: the fresh cells will run at
        // the new one, since the configuration will already have received it.
      turns: request.turns ?? config.turns,
      tools: allTools,
      deepen: toDeepen,
    },
    measured,
  );

  return {
    run,
    scenarios,
    targets,
    temperature,
    tools: allTools,
    cases,
    continued,
    continuedSampleIds,
    newJudges: [],
    estimate,
  };
}

/** The attempts a deepening keeps: graded by the given `run_judge_id` link (the
 *  principal, see the caller), and — when a list of grades is supplied — among
 *  those.
 *
 * Two requests rather than one: `judge_scores` carries neither `target_model`
 * nor `turns_done`, which `estimateExtension` nonetheless needs
 * (`groupByModelAndDepth`, in `deepen-counts.ts`) to cost by (model, starting
 * depth) pair — and which `extendRun` needs to find those same attempts by their
 * identifier. No join is possible in a single PostgREST request through this
 * minimal client (see `supabase.ts`), which knows only one table at a time per
 * call. */
async function deepenCandidates(
  runId: string,
  principalRunJudgeId: string,
  deepen: "all" | number[],
): Promise<{ id: string; target_model: string; turns_done: number | null }[]> {
  const scored = await select<{ sample_id: string }>(JUDGE_SCORES, {
    select: "sample_id",
    run_judge_id: `eq.${principalRunJudgeId}`,
    status: "eq.done",
    score: Array.isArray(deepen) ? `in.(${deepen.join(",")})` : "not.is.null",
  });
  if (scored.length === 0) return [];

  return select<{ id: string; target_model: string; turns_done: number | null }>(
    SAMPLES,
    {
      select: "id,target_model,turns_done",
      run_id: `eq.${runId}`,
      id: `in.(${scored.map((row) => row.sample_id).join(",")})`,
    },
  );
}

/** Adds a sub-matrix to an existing run.
 *
 * The cells already graded are not touched: only the new ones are born
 * `pending`, and the job plays out those alone. The repetitions added carry on
 * their pair's numbering rather than starting from zero, which is also what
 * stops the uniqueness constraint refusing the insertion.
 *
 * What the extension adds and costs is decided by `planExtension`, called here
 * as from the MCP route that checks a quote before launching: see its
 * documentation for why the two must not recompute it each its own way.
 *
 * `by` and `via` are not guessed here: it is the two callers — the web route and
 * the MCP tool `launch_draft` — that know who is asking and through which door.
 * An entry is laid in `eval_runs.extensions` for every extension that really
 * adds or deepens something, with the run's cost as it was just before — see
 * `RunExtensionLogEntry` and, for the real cost deduced from it,
 * `run-extensions.ts`.
 *
 * Two gestures on `judge_scores`, on top of the cells themselves, both necessary
 * since the multiple judges and absent before this function:
 * - the fresh cells have, at their birth, no score row for any judge —
 *   `write_judge_score` (the engine, `supabase_store.py`) only does a targeted
 *   `UPDATE`, never an `INSERT`; without rows pre-created here, `pending`, any
 *   verdict on a fresh cell would be lost in silence (see
 *   `judgeScoresForSamples`, `launch-judges.ts`);
 * - the deepened attempts keep, on `judge_scores`, the verdict of EVERY living
 *   judge of the run on their previous, shorter conversation: they must be put
 *   back to pending, not only the principal's which served to choose them (see
 *   `planExtension`) — a secondary judge keeping its old verdict would leave it
 *   committed to a text that is no longer the judged conversation.
 *
 * Returns the number of cells added, plus those put back to pending to be
 * continued — and the mode in which the job must start to do what this extension
 * asks. The mode comes from here and not from the caller: the engine has two
 * passes, `run` to play fresh cells and `catchup` to have conversations already
 * finished reread, and only this function knows which one the extension really
 * produced. Leaving it to the caller means two places that must agree with
 * nothing forcing them to — the choice would be right in one and wrong in the
 * other the day the other passed a judge. */
export async function extendRun(
  runId: string,
  request: ExtendRequest,
  by: string,
  via: "ui" | "mcp",
): Promise<{ added: number; mode: JobMode }> {
  const {
    run,
    scenarios,
    targets,
    temperature,
    tools: allTools,
    cases,
    continued,
    continuedSampleIds,
    newJudges,
    estimate: addition,
  } = await planExtension(runId, request);

  // Laying a judge touches no cell. `addJudge` creates its link and its pending
  // score rows on every conversation of the run; it is the catch-up, launched
  // just afterwards by the caller, that fills them. A separate path because
  // `extendProblem` forbids mixing that gesture with the addition of cells: the
  // two ask the engine for two different passes, and one launch does only one.
  if (newJudges.length > 0) {
    for (const spec of newJudges) await addJudge(runId, spec, by);
    await update(
      RUNS,
      {
        estimate: addition ? addEstimates(run.estimate, addition) : run.estimate,
        extensions: [
          ...run.extensions,
          {
            at: new Date().toISOString(),
            by,
            via,
            request,
            estimate: addition,
            cost_before_usd: run.cost_usd,
          },
        ],
        status: "triggered",
        error: null,
        finished_at: null,
      },
      { id: `eq.${runId}` },
    );
    return { added: newJudges.length, mode: "catchup" };
  }

  if (cases.length === 0 && continued === 0) return { added: 0, mode: "run" };

  const config = run.config;

  // The history entry joins the writing of the configuration rather than opening
  // a request of its own: both describe the run itself, and a breakdown that left
  // one without the other — `turns` already advanced without anything saying why,
  // or the reverse — would be half a piece of information. `cost_before_usd` is
  // the one read by `planExtension` above, hence strictly the one from before
  // this write.
  await update(
    RUNS,
    {
      config: {
        ...config,
        tools: allTools,
        turns: request.turns ?? config.turns,
        scenarios,
        models: {
          ...config.models,
          targets,
            // The world model is laid only once. `extendProblem` refuses to
            // change one that exists — two servers within one run would make its
            // cells incomparable — so the run's always wins, and the extension
            // can only fill a gap.
            //
            // Without this line, the extension's first case passed validation
            // then got lost: the run stayed with no server, and nothing said so.
            // Validated, never applied.
          world: resolvedWorld(config, request),
        },
        temperature,
      },
      total_samples: run.total_samples + cases.length,
      estimate: addition ? addEstimates(run.estimate, addition) : run.estimate,
      extensions: [
        ...run.extensions,
        {
          at: new Date().toISOString(),
          by,
          via,
          request,
          estimate: addition,
          cost_before_usd: run.cost_usd,
        },
      ],
      status: "triggered",
      error: null,
      finished_at: null,
    },
    { id: `eq.${runId}` },
  );

  // `returning: true`: the fresh cells' real identifiers are needed — generated
  // in the database, `NewCell` carries none — to lay rows of `judge_scores` on
  // them, just below.
  const inserted = await insert<{ id: string }>(
    SAMPLES,
    cases.map((cell) => ({ run_id: runId, ...cell })),
    { returning: true },
  );

  // The run's living judges, of which neither the fresh cells nor the deepened
  // attempts have an up-to-date score row yet — see this function's head comment
  // for the two different reasons that demand it on both sides. One single read
  // for both gestures.
  const liveJudgeIds =
    inserted.length > 0 || continuedSampleIds.length > 0
      ? (await loadLiveRunJudges(runId)).map((judge) => judge.id)
      : [];

  if (inserted.length > 0 && liveJudgeIds.length > 0) {
    await insert(
      JUDGE_SCORES,
      judgeScoresForSamples(
        runId,
        liveJudgeIds,
        inserted.map((sample) => sample.id),
      ),
    );
  }

  // The attempts to continue go back to pending while keeping their
  // conversation: it is that pairing — `pending` with `messages` — that tells the
  // engine to continue rather than replay. `turns_done` does not move: it is
  // that, compared to `config.turns` already written above, which will
  // distinguish an attempt to carry on from an attempt already at its depth.
  if (continuedSampleIds.length > 0) {
    await update(
      SAMPLES,
      { status: "pending", error: null, finished_at: null },
      { id: `in.(${continuedSampleIds.join(",")})` },
    );

    // Their verdict goes now, not afterwards — on `judge_scores`, every living
    // judge of the run included, not only the principal which served to choose
    // them (see `planExtension`). It bore on a shorter conversation and says
    // nothing of the one to come; a breakdown along the way must leave an attempt
    // with no verdict rather than an attempt carrying a verdict that no longer
    // corresponds.
    if (liveJudgeIds.length > 0) {
      await update(
        JUDGE_SCORES,
        { status: "pending", score: null, justification: "", error: null },
        {
          run_judge_id: `in.(${liveJudgeIds.join(",")})`,
          sample_id: `in.(${continuedSampleIds.join(",")})`,
        },
      );
    }
  }

  return { added: cases.length + continued, mode: "run" };
}

/** A published run, as a stranger can read it.
 *
 * An unknown run and an unpublished run raise the same error, with the same
 * message: from outside, the two must look alike, otherwise the address says who
 * exists.
 *
 * The only write that takes place here goes through `loadRun`, which purges the
 * stuck runs before even knowing whether this one is public — `failStaleRuns`
 * runs for every caller, authenticated or not. Harmless: its predicate depends
 * only on `status` and `updated_at`, never on what the caller supplies, and the
 * call is throttled to once every 30 seconds per process. But it is not nothing
 * either — naming it here stops a future call added inside `loadRun` slipping in
 * without anyone wondering whether it is still acceptable in front of an
 * anonymous caller.
 *
 * Throws:
 *   NotFound: if no run carries this identifier, or if it is not published.
 */
export async function loadPublicRun(
  runId: string,
  options: { withTranscripts?: boolean; withJudges?: boolean } = {},
): Promise<PublicRunDetail> {
  // The button that reads `source_csv_available` only exists on the private page,
  // and the stranger reading a published page has nothing to do with it — hence
  // excluding it explicitly here. The catch-up count does not need the same
  // gesture: it is already on demand by default (see `catchupMissingTotal`), and
  // this route never asks for it — there is no write button here. `withJudges`
  // passes through as it stands: `withoutIdentity`, below, removes `created_by`
  // from each judge before anything goes out.
  const detail = await loadRun(runId, {
    ...options,
    withSourceCsvFlag: false,
  });
  if (!detail.run.is_public) throw new NotFound(`Unknown run: ${runId}`);
  return withoutIdentity(detail);
}

/** Setting a run aside from the lists and from public reading, erasing nothing.
 *
 * A run costs money and carries notes: making it unrecoverable on one click
 * would be disproportionate. The row stays, `deleted_at` takes it out of
 * everywhere — `loadRun` and `loadRuns` filter on it, so the page, the list, the
 * public reading and the MCP tools all ignore it at once.
 *
 * Once the run is marked, its tag links are withdrawn: a tag lives only as long
 * as something *alive* carries it, and the move to the bin no longer counts as
 * alive. The `delete_orphan_tag` trigger does the rest — if that link was the
 * last one, the tag disappears with it. Without that withdrawal, a binned run
 * would keep a tag alive without it being visible anywhere.
 *
 * `deleted_at` is laid first: if the withdrawal of the links fails, the run
 * simply stays in the bin with its tags still attached — today's state,
 * harmless. The reverse order would detach the tags of a run which, if the
 * following deletion failed, would not even be set aside. */
export async function softDeleteRun(runId: string): Promise<void> {
  await update(RUNS, { deleted_at: NOW }, { id: `eq.${runId}` });
  await remove(RUN_TAGS, { run_id: `eq.${runId}` });
}

/** Publishing or unpublishing. The only place that writes this column. */
export async function setPublic(runId: string, isPublic: boolean): Promise<void> {
  await update(RUNS, { is_public: isPublic }, { id: `eq.${runId}` });
}

/** One single conversation, without loading the rest of the run — a run carries
 *  dozens of cells, and bringing them all back to return only one would be the
 *  kind of hidden cost that only shows in production.
 *
 * The run is checked first, and that is this read's only purpose: the cells do
 * not carry `deleted_at`, it lives on the run. Without that check, a run set
 * aside would keep returning its trajectories one by one — the one door a filter
 * laid on `eval_samples` alone would not have closed.
 *
 * Throws:
 *   NotFound: if the run is unknown or set aside, or if no cell carries this
 *   triplet.
 */
export async function loadSampleTranscript(
  runId: string,
  scenarioIndex: number,
  targetModel: string,
  repetition: number,
): Promise<EvalSample> {
  const alive = await select<{ id: string }>(RUNS, {
    id: `eq.${runId}`,
    select: "id",
    deleted_at: "is.null",
    limit: 1,
  });
  if (alive.length === 0) throw new NotFound(`Unknown run: ${runId}`);

  const rows = await select<EvalSample>(SAMPLES, {
    run_id: `eq.${runId}`,
    scenario_index: `eq.${scenarioIndex}`,
    target_model: `eq.${targetModel}`,
    repetition: `eq.${repetition}`,
    select: "*",
    limit: 1,
  });
  const sample = rows[0];
  if (!sample) {
    throw new NotFound(
      `Unknown sample: run ${runId}, scenario ${scenarioIndex}, ${targetModel}, repetition ${repetition}`,
    );
  }
  sample.messages ??= [];
  sample.usage ??= {};
  return sample;
}
