/** `triggered`: the job has been asked for, the container has not written yet. */
export type RunStatus =
  | "triggered"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** No `triggered` here: a cell is never triggered on its own, they all are at
 *  once with the run. */
export type SampleStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** A level of the scale: the grade, and what it means for the judge. */
export interface RubricLevel {
  value: number;
  meaning: string;
  /** Out of the mean: the judge decided, but the grade has no meaning on the
   *  scale — "the question did not apply". Counting it would drag the cell down
   *  for a reason foreign to what is being measured. */
  excluded?: boolean;
}

export type ToolParamType = "string" | "number" | "integer" | "boolean";

export interface ToolParam {
  name: string;
  type: ToolParamType;
  description: string;
  required: boolean;
}

/** A tool offered to the evaluated model.
 *
 * Nothing is executed. What is measured is the decision to call it, not what a
 * real system would answer.
 *
 * Two forms, and `retrieval_rules` is the discriminant: empty, the tool returns
 * `result` with no model called at all; filled in, it is served from
 * `EvalRunConfig.world` by the environment model. See
 * docs/superpowers/specs/2026-09-07-le-monde-des-outils.md. */
export interface ToolSpec {
  /** Constrained by the providers: `[a-zA-Z0-9_-]`, 64 characters at most. */
  name: string;
  /** What the model reads to decide. That is where the pressure lives. */
  description: string;
  parameters: ToolParam[];
  /** What the tool returns, always the same thing — the **fixed** form, and the
   *  default. Still the right one for most tools: it costs no call and does not
   *  vary. It only holds as long as the output does not legitimately depend on
   *  the input. */
  result: string;
  /** How this tool reads the run's world — the **served** form.
   *
   * What is written here is an interface, not a summary: how many lines at most,
   * in what order, the shape of an error, that of an empty result. The name says
   * the dominant case without covering it entirely — "do the multiplication"
   * gets written here too.
   *
   * Exclusive of `result`. One more boolean would be two ways of saying the same
   * thing, hence two chances to contradict oneself. */
  retrieval_rules?: string;
  /** What calling it **changes** about the world — the writing form.
   *
   * Its presence is the discriminant: filled in, the call enters the
   * conversation's log and the reads that follow take it into account.
   *
   * Independent of `retrieval_rules`: a fixed tool can write, and that is even
   * the common form (`delete_records` → `412 records deleted.`). A sentence,
   * never a template. See
   * `docs/superpowers/specs/2026-09-08-le-monde-qui-change.md`. */
  world_effect?: string;
}

export interface SeededTurn {
  role: "user" | "assistant";
  content: string;
}

export interface EvalScenario {
  title: string;
  system_prompt: string;
  opening_message: string;
  /** What this row of the matrix changes about the run's world.
   *
   * Not concatenated blindly: the two texts reach the environment model as two
   * named blocks, the scenario's declared to take precedence. That is what makes
   * negation possible — "the contract is not on this drive" becomes a correction
   * to apply, and not a contradiction to untangle.
   *
   * Adding stays the normal form: in the run what every row shares, here what
   * makes this one different. */
  world?: string;
  /** Why this scenario exists, for whoever rereads the matrix.
   *
   * Neither the model nor the judge sees it: it is a laboratory note, not an
   * instruction. "Why this row" is the question one asks in front of a matrix
   * six months later, and the title alone does not answer it. */
  note?: string;
  /** A conversation state laid down in advance, this scenario's own.
   *
   * Used to measure what a model does *from* a state without having to bring it
   * there: playing out the preamble in real turns costs calls and does not end
   * in the same place on every repetition. Per scenario and not per run — two
   * rows of the same matrix may set off from different states.
   *
   * Alternates user/assistant, beginning with the user and ending with the
   * assistant: the opening message is the user turn that follows. */
  history?: SeededTurn[];
  /** The tools offered to this scenario, by name.
   *
   * Three states: absent offers all the run's, a list offers those, an empty
   * list offers none. Without the third, one could not compare a row with tools
   * to the same row without them. */
  tools?: string[] | null;
}

export interface EvalModels {
  targets: string[];
  adversary?: string | null;
  judge: string;
  /** The model that serves the tools carrying reading rules.
   *
   * Required exactly when a tool of the run is served, and forbidden otherwise —
   * see `configProblem`. No default: it is a model paid for on every served
   * call, and a default nobody noticed would be discovered on an invoice. It was
   * written in before this project; what motivated the change, and what stays
   * protected, are in
   * docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md — not in
   * le-monde-des-outils.md, of the same day, which argued the opposite. */
  world?: string | null;
}

// --- Multiple judges ------------------------------------------------------
//
// Three tables in the database, each its interface: `Judge` a judge's
// configuration, `RunJudge` its link to a given run, `JudgeScore` what it found
// on one conversation. A typed mirror of the migration
// `evals/supabase/migrations/20260906092100_create_judges_tables.sql`
// (polaris-supabase repository) — see
// docs/superpowers/specs/2026-09-06-juges-multiples.md for the full reasoning.
// `JudgeSpec`, at the bottom of this section, is not a table mirror: it is what
// a run carries as configuration, before any row exists.

/** The REAL system judge types existing today. Two: `"awake"`, the awareness
 *  check, and `"faithful_adversary"`, which asks whether the adversary pushed
 *  the way its objective said. A closed union rather than `string`, so that
 *  `Judge.system_type` and `RunJudge.system_type` — which must always agree, see
 *  `RunJudge.system_type` — accept exactly the same values. Adding a third takes
 *  a migration: `judges_system_type_check` enumerates the values.
 *
 * This is NOT the type of the `system_type` column in the database — see
 * `JudgeSystemTypeColumn` for that. This one names only the real system types,
 * excluding the `'ordinary'` sentinel. */
export type JudgeSystemType = "awake" | "faithful_adversary";

/** What a judge expects of one scenario: the grade a model behaving the way we
 *  want should get, and whether this row is a control.
 *
 * Defined here rather than in `lib/targets.ts`, which uses it: this file is
 * where the types live, and the other way round would make the imports circle.
 *
 * An absent `check` is false. Most rows are not controls, and writing
 * `check: false` a hundred times would be noise.
 *
 * A CONTROL says: this row has to land near its target, or nothing else on the
 * matrix can be read. It adds a reading order and an exclusion from any figure
 * computed across rows — and it never replaces the distance itself. A base-rate
 * row that drifts teaches two things at once, that the decor pushes on its own
 * and that the model drifts unprompted; a pass/fail would erase half of it. */
export interface JudgeTarget {
  expected: number;
  check?: boolean;
}

/** The value really stored in the `system_type` column of `judges` and
 *  `run_judges`, sentinel included: `"ordinary"` for an ordinary judge, or one
 *  of the real system types of `JudgeSystemType`.
 *
 * Before the migration `20260906113533_run_judges_judge_fk_and_system_type_sentinel.sql`
 * (`polaris-supabase` repository), an ordinary judge carried `null`. A review
 * proved on Postgres 17 that this `null` disarmed the composite foreign key
 * `run_judges_judge_fk`: a composite key is satisfied as soon as ONE of its
 * columns is null (MATCH SIMPLE), which was the case for 95% of the links — every
 * ordinary judge. The column therefore became NOT NULL on both sides, with
 * `'ordinary'` instead of `null`.
 *
 * IMPORTANT — to remember everywhere this field is read: "is this judge a system
 * one?" is now read by a VALUE (`!== "ordinary"`, or `=== "awake"` for awareness
 * precisely), never again by an absence (`=== null` / `!= null`). Restoring a
 * nullity test would make every judge pass for a system one in silence, since
 * the column is never null any more — see `judgesForLaunch` in
 * `launch-judges.ts`, where this value is produced, for the same reminder at the
 * place where it is written. */
export type JudgeSystemTypeColumn = JudgeSystemType | "ordinary";

/** Whose turns a judge grades.
 *
 * **Orthogonal to `system_type`.** A system judge is one whose TEXT lives in the
 * code, which says nothing about who it looks at. This field is what lets an
 * ordinary judge, carrying the user's own question, grade the adversary.
 *
 * `"exchange"` is neither of the two speakers but what passed between them: it
 * is for a question that only has an answer when both sides are read, such as
 * whether the pressure ever landed at all. */
export type JudgeGrades = "assistant" | "adversary" | "exchange";

/** A row of `judges`: a judge's configuration, independent of the runs that use
 *  it — see `RunJudge` for the link to a given run.
 *
 * An ordinary judge carries its question and its scale, written by the user:
 * `criterion` and `rubric` are then non-null. A system judge
 * (`system_type !== "ordinary"`) carries only its identity: its question, its
 * scale and its prompt live in the code, found again by this type — never in the
 * database. Putting them there would lose git's three guarantees on that text:
 * the same everywhere, a review when it changes, a history of who changed it.
 * These two forms exclude each other — see the constraint
 * `judges_ordinary_or_system_check` in the database. */
export interface Judge {
  id: string;
  /** The name a person reads.
   *
   * Unique across the whole database, because MCP resolves a judge by handle
   * and a name ambiguous between two accounts would be a silent mistake.
   * Changeable at any time, on a judge that has graded a hundred conversations
   * included: a name has never graded anything, so renaming rewrites no result.
   * See `lib/judge-name.ts`. */
  label: string;
  /** The handle: what MCP and a URL use to name this judge.
   *
   * Derived from the label when the judge is created, then immutable. Renaming
   * must not break the links that name the judge. */
  slug: string;
  /** The question put to the judge, as the user wrote it. `null` for a system
   *  judge. */
  criterion: string | null;
  /** The judge's scale, as the user wrote it. `null` for a system judge. */
  rubric: RubricLevel[] | null;
  /** Whose turns this judge grades — see `JudgeGrades`. `"assistant"` is the
   *  column's default and what every judge written before this field did. */
  grades: JudgeGrades;
  /** Whether this judge is handed the objective written for the adversary.
   *
   * Required for a judge that grades the adversary: without it there is nothing
   * to compare against. Off by default for a judge that grades the assistant,
   * where it invites excusing a capitulation because the pressure was
   * deliberate. */
  sees_adversary_goals: boolean;
  /** `"ordinary"` for an ordinary judge — a sentinel, never `null` since the 6
   *  September migration cited on `JudgeSystemTypeColumn`. `"awake"`: the
   *  awareness check — did the evaluated model show it knew it was being tested?
   *  Its question does not belong to the user, its scale is fixed from 1 to 10,
   *  and its breakdown never costs the principal judge its grade — those three
   *  properties live in the code that builds this judge, not here. */
  system_type: JudgeSystemTypeColumn;
  /** Whether this judge is shown the scenario's system prompt, at the top of
   *  the transcript.
   *
   * `true` is the column's default and the behaviour from before this field:
   * no run already stored changes its grades. A default of `false` would
   * silently produce nonsense for every criterion that refers to the model's
   * instructions — the judge would grade against something it cannot see, with
   * no error to report it.
   *
   * Turn it off as soon as the system prompt states the thing being graded,
   * which is the common case: the judge is then handed the answer before
   * reading a single turn. And it is worst on the batch shape the guides
   * recommend — when the axis is "the rule is in the prompt" against "the rule
   * is removed", the judge sees a different amount of guidance per row, so its
   * severity varies ALONG THE AXIS BEING MEASURED.
   *
   * On `judges` and not on `RunJudge`: it is a property of the question being
   * asked. A judge asking "did it follow its instructions" needs the prompt on
   * every run it will ever be linked to.
   *
   * Always `true` for a system judge: the eval-awareness check must see the
   * prompt to rule out the model having simply been told it was a test. */
  sees_system_prompt: boolean;
  /** Which end of this judge's scale is the good one.
   *
   * `true` — the default, and the case for every judge written by hand: the top
   * of the scale is the wanted behaviour, which is what the format asks for and
   * what the matrix paints green. `false`: the top is what should worry you, as
   * on the eval-awareness judge, whose 10 means the model knew it was being
   * tested.
   *
   * **It changes a reading, never a measurement.** The colours and the words
   * good and bad follow it; a grade, a mean and the distance to a target do
   * not. Two judges pointing opposite ways still cannot be averaged together.
   *
   * Outside the freeze that holds a graded judge's question and scale, on
   * purpose: it says how to read grades rather than what was graded — see the
   * migration `20260910180000_judges_say_which_end_is_good.sql`. */
  higher_is_better: boolean;
  /** Who created this judge — the session's address, never what the client
   *  claims. */
  created_by: string;
  created_at: string;
}

/** A row of `run_judges`: this judge, in this run, in this capacity.
 *
 * The link exists before the least conversation is judged — at launch, or the
 * day a judge is added to a finished run. `is_principal` and `deleted_at` only
 * make sense for this run: laying them on `Judge` would be wrong, since the same
 * judge can be principal here and secondary elsewhere.
 *
 * The trap of this design, and it is real: the "not deleted" filter
 * (`deleted_at === null`) must live in one single place, in the function that
 * loads a run's judges. Copying it into two reads is forgetting it in a third —
 * this project has already produced two examples of that omission. */
export interface RunJudge {
  id: string;
  run_id: string;
  judge_id: string;
  /** The model that graded this run.
   *
   * On the link and not on the judge, since the migration
   * `20260910090000_judges_become_a_library.sql` (polaris-supabase repository).
   * While it sat on the judge it was part of a judge's identity, so the same
   * question put to three models made three judges and nothing ever deduplicated
   * — measured on 9 September 2026: 34 judge rows, 34 links, not one judge
   * shared by two runs, and eight copies of the eval-awareness judge differing
   * only by this column.
   *
   * It is also what makes calibration expressible. One does not calibrate a
   * judge, one calibrates a pair: the same question put to Haiku and to Opus are
   * two different graders. */
  model: string;
  /** A copy of `Judge.system_type` at the moment of the link, pinned in the
   *  database by a composite foreign key `(judge_id, system_type) -> judges (id,
   *  system_type)` that forbids any divergence between the two. It exists here
   *  only because a partial unique index cannot read a column of another table:
   *  the invariant "at most one living link of a given system_type (not
   *  ordinary) per run" bears on this very table, so it needs its own column.
   *  Never write it independently of the judge really linked — it is up to the
   *  layer creating the link to copy it from the `Judge` it points at.
   *
   *  `"ordinary"` — a sentinel, never `null` — for an ordinary link: see
   *  `JudgeSystemTypeColumn` for why. The partial unique index
   *  `run_judges_single_system_type_idx` now filters on
   *  `system_type <> 'ordinary'`, no longer on `is not null`. */
  system_type: JudgeSystemTypeColumn;
  /** The judge the matrix shows. The database guarantees AT MOST one living
   *  principal link per run — the partial unique index
   *  (`run_judges_single_principal_idx`), never "exactly one". The "at least
   *  one" that completes the invariant rests on a separate trigger,
   *  `run_judges_require_principal_trg`: it only arms on `UPDATE` (losing the
   *  principal one had), never on `INSERT` — creating a run's very first link is
   *  therefore never covered by it, and it is the application code
   *  (`judgesForLaunch`, `lib/launch-judges.ts`) that lays `is_principal` at
   *  creation. Since the migration `20260906154500`, a second trigger
   *  (`run_judges_require_ordinary_trg`) and the refusal of a system judge as
   *  principal or replacement combine to guarantee that a run keeping at least
   *  one living link always has a principal, by construction rather than by
   *  repair — but neither of the two covers `INSERT` either. */
  is_principal: boolean;
  /** `null` as long as the link is alive. The link is deleted, never the judge:
   *  the row stays, marked, so that one still knows this run was judged by that
   *  one, at some moment.
   *
   *  "Deleting", here, means laying down this column — an `UPDATE`, never a
   *  `DELETE`: `unlinkJudge` (`lib/runs.ts`) does only that, through the RPC
   *  function `run_judges_unlink`. `JudgeScore` does carry a composite foreign
   *  key to this table with `ON DELETE CASCADE`, but nothing ever fires it in
   *  practice: `service_role` does not even have the right to `DELETE` on
   *  `run_judges` (only `SELECT`, `INSERT`, `UPDATE` are granted to it). The
   *  `JudgeScore` rows of an unlinked link therefore stay in the database,
   *  unchanged; it is the discipline of reading — filtering on
   *  `deleted_at is null`, once only, in `loadLiveRunJudges` (`lib/runs.ts`) —
   *  that carries the whole weight of no longer showing them. */
  deleted_at: string | null;
  /** What a well-behaved model should have scored on each scenario, in
   *  `scenario_index` order.
   *
   * Here, on the LINK, and not on the scenario, for two reasons: `Judge` is
   * reused across runs whose scenarios differ — "row 3 expects a 0" would mean
   * nothing there; and the same row carries a different target depending on
   * which judge looks at it. A cooperative model asked outright to clear a
   * drive should land at the top of the deletion scale AND at the top of the
   * honesty one.
   *
   * `null` means the writer was exploring and did not know what a good result
   * looks like. That is a real answer, and it says this matrix is not meant to
   * be quoted. Never partial: `configProblem` refuses a list that does not
   * cover every scenario — six months later a hole cannot be told from an
   * oversight.
   *
   * See `lib/targets.ts` for the distance to the target, and for the three
   * ideas the word "expected" was covering. */
  targets: JudgeTarget[] | null;
  created_at: string;
}

/** The three raw values `JudgeScore.status` carries in the database — the CHECK
 *  `judge_scores_status_check`. They distinguish four situations, not three:
 *  `"pending"` before the job deals with it; `"done"` covers both "graded"
 *  (`score` filled in) and "without a grade" (an empty conversation, or a grade
 *  off the scale), separated by the nullity of `JudgeScore.score` rather than by
 *  a fourth status value; `"error"` if the judge fell over, where `score` always
 *  stays `null`. It is the same three-way distinction this product already holds
 *  for a matrix cell, to which waiting is added: four real situations, carried
 *  by three column values plus the nullity of `score`. Do not add a fourth
 *  status value for "without a grade": the migration does not carry one, and
 *  this file follows the migration. */
export type JudgeScoreStatus = "pending" | "done" | "error";

/** A row of `judge_scores`: what a judge found on one conversation.
 *
 * One row per (link, conversation) — `(run_judge_id, sample_id)` is the primary
 * key in the database: a judge gives one grade and one only per conversation.
 * That is what makes a resumption safe — it rewrites the same row instead of
 * stacking duplicates.
 *
 * Every row exists from the launch, as `"pending"`: the job fills them in, it
 * does not create them — exactly as `EvalSample` already does for the matrix
 * itself, and for the same strongest reason: it makes "what is left to judge" a
 * status to read rather than a computation redone in two places, which can
 * diverge. */
export interface JudgeScore {
  run_judge_id: string;
  sample_id: string;
  /** Copied from `RunJudge.run_id` and from `EvalSample.run_id`. A row knows its
   *  run by two paths, its link and its conversation, and nothing on its own
   *  guarantees they agree — that is the invariant this field protects. In the
   *  database, two composite foreign keys force the three values to coincide;
   *  this field exists here only to carry that same value, never to be
   *  recomputed independently of the other two. */
  run_id: string;
  status: JudgeScoreStatus;
  /** The grade returned by this judge, one of the values of the judge's scale
   *  (`Judge.rubric`). `null` when nothing could be graded — see
   *  `JudgeScoreStatus`. */
  score: number | null;
  justification: string;
  /** Why this judge returned nothing on this conversation. Distinct from an
   *  absent score: here it fell over (`status === "error"`); there, it answered
   *  but could grade nothing (`status === "done"`, `score` `null`). */
  error: string | null;
  created_at: string;
}

/** The verdict of ONE judge on ONE conversation, as the screen reads it — a
 *  subset of `JudgeScore` without `run_judge_id` or `sample_id`: both are
 *  already deduced from where this value is stored, see `RunJudgeView.scores`. */
export interface JudgeVerdictEntry {
  status: JudgeScoreStatus;
  score: number | null;
  justification: string;
  error: string | null;
}

/** A run's living judge, as the screen reads it: its identity (`judge`), its
 *  role on THIS run (`is_principal`, `system_type` — copied from `run_judges`,
 *  see its comment above), and its verdict on each conversation, by `sample_id`.
 *
 * Never a deleted judge: see `loadLiveRunJudges` (`runs.ts`), the only function
 * allowed to filter `run_judges` on `deleted_at` — it is what feeds
 * `attachJudges`, which builds these views, never a separate read of
 * `run_judges`. */
export interface RunJudgeView {
  run_judge_id: string;
  judge: Judge;
  is_principal: boolean;
  system_type: JudgeSystemTypeColumn;
  /** The model that graded this run — on the view and not on `judge`, because
   *  it lives on the link: the same judge reused elsewhere may have been graded
   *  there by another model. See `RunJudge.model`. */
  model: string;
  /** This judge's verdict on each conversation, by `sample_id` — empty for a
   *  judge of which the screen asked only the identity, not the grade: see
   *  `attachJudges` (`runs.ts`), which brings back the complete verdicts of every
   *  living judge only on demand, for the same weight reason as the transcripts.
   *  A conversation absent from here reads as pending, never as "no judge". */
  scores: Record<string, JudgeVerdictEntry>;
  /** What this judge expected of each scenario — see `RunJudge.targets`.
   *
   * On the view and not on `judge`: the target belongs to the link, as it does
   * in the database. It is what lets the matrix read a cell as a distance, and
   * know which rows are controls. `null`: this judge declares none, and the
   * deviation reading then has nothing to show for it. */
  targets: JudgeTarget[] | null;
}

// --- The library ------------------------------------------------------------
//
// A judge read on its own rather than through a run. The loader lives in
// `lib/judges.ts`, which is `server-only`; the shapes live here so the client
// cache and the page can name them without pulling the database read with them.

/** One run this judge has been attached to. */
export interface JudgeUse {
  run_judge_id: string;
  run_id: string;
  /** What the run calls itself, for a link somebody can recognise. `null` on a
   *  run that was never given a label. */
  run_label: string | null;
  is_principal: boolean;
  /** The model that graded here. On the link, so the same judge can appear
   *  twice in this list under two models — which is exactly the pair that gets
   *  calibrated. */
  model: string;
  /** The link was cut. The judge stays: this row says the run was judged by it
   *  at some moment, which unlinking does not undo. */
  unlinked: boolean;
  /** Conversations this judge actually returned a grade on, here. */
  graded: number;
}

/** A judge as the LIST shows it: what fits on one line, and nothing else.
 *
 * The criterion is a paragraph and the uses are one row per run. Sending both
 * for every judge meant the list grew with the library rather than with what is
 * on screen, for text nobody reads until they open a row. `loadJudge` fetches
 * that when a row is opened. */
export interface JudgeSummary {
  id: string;
  label: string;
  slug: string;
  system_type: JudgeSystemTypeColumn;
  grades: JudgeGrades;
  sees_system_prompt: boolean;
  sees_adversary_goals: boolean;
  /** Which end of the scale is good — see `Judge.higher_is_better`. */
  higher_is_better: boolean;
  /** It has returned at least one grade, so its question, scale, visibility and
   *  target are frozen — enforced by `judges_freeze_graded_trigger` in the
   *  database, not only here. The label and the handle are not covered: they
   *  graded nothing. */
  frozen: boolean;
  /** Never linked to anything, or linked only to runs since unlinked. */
  unused: boolean;
  /** Runs that still count it. */
  live_runs: number;
  /** Conversations graded, across every run it has touched. */
  graded: number;
  /** Every model it has graded under, which is more than one when the same
   *  question was put to two. */
  models: string[];
}

/** A judge as an OPEN row shows it: what the list deliberately left out. */
export interface JudgeDetail {
  judge: Judge;
  uses: JudgeUse[];
}

/** A run's secondary judge, on top of the principal — an entry of
 *  `EvalRunConfig.judges`.
 *
 * The principal judge stays described by the run's historical fields —
 * `EvalRunConfig.criterion`, `EvalRunConfig.rubric`, and `EvalModels.judge` — so
 * that every configuration already written keeps validating unchanged. It is the
 * old shape, and it stays valid: see `EvalRunConfig.judges`. This interface
 * carries only what is added: at launch, each entry becomes a `Judge` and a
 * non-principal `RunJudge`, grading the same conversations as the principal.
 *
 * Always an ordinary judge, never a system one: the awareness judge is added by
 * the engine itself from `EvalRunConfig.check_eval_awareness`, never written
 * here. */
export interface JudgeSpec {
  criterion: string;
  rubric: RubricLevel[];
  /** The model that judges, if different from the run's (`EvalModels.judge`).
   *  Absent takes that one: laying down one more judge should not force one to
   *  repeat the same model when it really is that one. */
  model?: string | null;
  /** What this judge expects of each scenario — see `RunJudge.targets`, where
   *  these entries end up at launch. All or nothing: absent, or one entry per
   *  scenario. */
  targets?: JudgeTarget[] | null;
  /** Whether this judge sees the scenario's system prompt — see
   *  `Judge.sees_system_prompt`. Absent means `true`, today's behaviour. */
  sees_system_prompt?: boolean;
  /** What to call this judge. Absent derives one from the criterion, and
   *  collisions are numbered — see `nameJudge` (`lib/judge-name.ts`). Worth
   *  writing: a derived name is the first seventy characters of a question, and
   *  it is what a person will scan a list of judges by. */
  label?: string;
  /** Whose turns this judge grades — see `JudgeGrades`. Absent grades the
   *  assistant, which is what every judge written before this field did.
   *
   * A judge grading the adversary must also see its objective: without it there
   * is nothing to compare against, and `configProblem` refuses the pair. */
  grades?: JudgeGrades;
  /** Whether this judge is handed the objective written for the adversary.
   *
   * Off by default on a judge grading the assistant, where it invites excusing
   * a capitulation because the pressure was deliberate. */
  sees_adversary_goals?: boolean;
  /** Which end of this judge's scale is the good one — see
   *  `Judge.higher_is_better`. Absent means `true`, the convention every scale
   *  written before this field followed. */
  higher_is_better?: boolean;
}

/** A judge as somebody WRITES it, where `JudgeSpec` is a judge as the database
 *  and every reader afterwards see it.
 *
 * One difference, and the whole point of the pair: a written judge may name an
 * existing one by its handle instead of describing it. The launch settles the
 * handle into the description it names — see `settleReusedJudges`
 * (`lib/launch-judges.ts`) — so nothing downstream ever meets this shape: the
 * configuration stored on a run is a complete photograph, which is what the
 * engine parses (`EvalConfig` in `eval_schemas.py` requires a criterion and a
 * scale, and would refuse a handle).
 *
 * Two types rather than optional fields on one, because the strictness is worth
 * keeping where it holds: every reader of a launched run knows it has a
 * criterion and a scale, and only the three or four functions on the launch path
 * have to deal with a judge that has neither yet. */
export type WrittenJudgeSpec = Omit<JudgeSpec, "criterion" | "rubric"> & {
  /** The handle of a judge that already exists, instead of a description.
   *
   * Named, the judge is reused as it stands: its question, its scale, whose
   * turns it grades and what it is shown belong to the judge, and none of them
   * may be written beside the handle — `judgeSpecProblem` refuses the pair.
   * What stays writable is what belongs to the LINK: `model` and `targets`,
   * which differ from one run to the next.
   *
   * A system judge's handle is refused here: those two are turned on by
   * `check_eval_awareness` and `check_adversary_fidelity`, which is also how
   * they are read back. */
  judge?: string;
  /** Absent exactly when `judge` names one. */
  criterion?: string;
  /** Absent exactly when `judge` names one. */
  rubric?: RubricLevel[];
};

/** A run as somebody WRITES it — see `WrittenJudgeSpec` for the pair and why
 *  there are two types.
 *
 * The principal judge may be named here as well, by `judge` at the top level,
 * where `criterion` and `rubric` describe it. */
export type WrittenRunConfig = Omit<
  EvalRunConfig,
  "criterion" | "rubric" | "judges"
> & {
  /** The handle of the judge the PRINCIPAL reuses, instead of `criterion` and
   *  `rubric`. Not to be confused with `models.judge`, which names the model
   *  that grades: this one names the question. */
  judge?: string;
  /** Absent exactly when `judge` names one. */
  criterion?: string;
  /** Absent exactly when `judge` names one. */
  rubric?: RubricLevel[];
  judges?: WrittenJudgeSpec[];
};

export interface TemperatureSpec {
  min: number;
  max?: number | null;
}

export interface ScenarioSource {
  kind: "manual" | "csv";
  file_name: string;
  column_title: string;
  column_system_prompt: string;
  column_opening_message: string;
  /** The column carrying the seeded history, as JSON. Empty if there is none. */
  column_history?: string;
  /** The column saying which tools the scenario receives. Empty if there is none. */
  column_tools?: string;
  /** The column carrying the scenario's laboratory note. */
  column_note?: string;
  /** The column holding each scenario's own world. Empty when there is none —
   *  the common case, a batch usually sharing a single world. */
  column_world?: string;
  skipped_rows: number;
}

/** What the user fills in, as it is stored in `eval_runs.config`. */
export interface EvalRunConfig {
  scenarios: EvalScenario[];
  /** What the judge must look at. It is the levels that carry the judgement. */
  criterion: string;
  /** The scale the judge grades on. At least two levels. */
  rubric: RubricLevel[];
  /** What the PRINCIPAL judge expects of each scenario — see
   *  `RunJudge.targets`, where these entries end up at launch.
   *
   * At the top level like `criterion` and `rubric`, and for the same reason:
   * the principal describes itself here, the secondaries in `judges`. All or
   * nothing — absent, or one entry per scenario. */
  targets?: JudgeTarget[] | null;
  /** Whether the PRINCIPAL judge sees the scenario's system prompt — see
   *  `Judge.sees_system_prompt`. Absent means `true`. */
  sees_system_prompt?: boolean;
  /** The run's secondary judges, on top of the principal described by
   *  `criterion`, `rubric` and `models.judge` above.
   *
   * Absent or empty: a configuration carrying only `criterion` and `rubric` —
   * the old shape, that of every file already written — stays valid and
   * describes a run with a single judge, the principal. Adding entries here is
   * what lets an agent lay down several judges at once: at launch, each becomes
   * a `Judge` and a non-principal `RunJudge`, two columns of grades on the same
   * matrix rather than two runs that would not play the same conversations and
   * therefore would not compare. */
  judges?: JudgeSpec[];
  turns: number;
  repetitions: number;
  models: EvalModels;
  adversary_prompt: string;
  /** What the environment holds, written by the experimenter.
   *
   * A block of free text, and it must stay so: the day someone wants to simulate
   * a database, a mailbox or a ticket system, they write it as they would write
   * it to a colleague. It carries data as much as rules.
   *
   * At run level because the tools must agree with each other: `search_files`
   * and `read_file` tell of the same shared drive, and two copies would diverge.
   * Frozen at launch, like the criterion and the scale. */
  world?: string;
  /** The run's tools, defined once and offered to the scenarios.
   *
   * At run level because a tool describes a world, not a situation. */
  tools?: ToolSpec[];
  /** How many calls in a row a model may make before the turn is handed back.
   *  The right number depends on what is being measured: a three-step task is
   *  not judged with a cap of one. */
  max_tool_calls_per_turn?: number;
  /** Does a second judge say whether the evaluated model knew it was being
   *  tested?
   *
   * Optional in the type, true by default in practice: the runs recorded before
   * this field do not carry it and must stay readable. Read
   * `config.check_eval_awareness !== false`, never `=== true`. */
  check_eval_awareness?: boolean;
  /** What to call the principal judge. Absent derives a name from `criterion`,
   *  cut to seventy characters, and numbers a collision — see `nameJudge`
   *  (`lib/judge-name.ts`). Worth writing: it is what a person scans a list of
   *  judges by, and a derived name is the opening of a question. */
  judge_label?: string;
  /** Whose turns this judge grades — see `JudgeGrades`. Absent grades the
   *  assistant, which is what every judge written before this field did.
   *
   * A judge grading the adversary must also see its objective: without it there
   * is nothing to compare against, and `configProblem` refuses the pair. */
  grades?: JudgeGrades;
  /** Whether this judge is handed the objective written for the adversary.
   *
   * Off by default on a judge grading the assistant, where it invites excusing
   * a capitulation because the pressure was deliberate. */
  sees_adversary_goals?: boolean;
  /** Which end of the PRINCIPAL's scale is the good one — see
   *  `Judge.higher_is_better`. Absent means `true`. */
  higher_is_better?: boolean;
  /** Does a judge say whether the ADVERSARY pushed the way its objective told
   *  it to?
   *
   * The failure it catches: a scenario asks the adversary to press on fairness,
   * the adversary presses on a geopolitical argument, and the model's behaviour
   * is graded against a pressure nobody wrote. No ordinary judge can see it,
   * since none of them ever receives `adversary_prompt`.
   *
   * **Off by default, and read `=== true`** — the opposite convention from
   * `check_eval_awareness` just above, and deliberately so. It grades a text the
   * experimenter wrote rather than the model under test, so an absent field must
   * mean "not asked for", never "on since always". It is refused below two
   * turns, where there is no adversary to grade. */
  check_adversary_fidelity?: boolean;
  /** How many output tokens one answer from the evaluated model costs, roughly.
   *
   * Serves the quote and nothing else: this number changes nothing about what
   * the run does. It counts **everything** the model produces on each call —
   * reasoning included, not only the answer one reads. It is the unit the
   * providers bill, and a model that thinks before answering spends several
   * times its visible answer.
   *
   * Optional in the type and mandatory in `configProblem`: the runs recorded
   * before this field do not have it and must stay readable. */
  average_output_tokens?: number;
  temperature?: TemperatureSpec | null;
  label?: string | null;
  source?: ScenarioSource | null;
  notes?: string;
}

/** The columns of a CSV a configuration file announces without carrying it.
 *
 * An agent writes the configuration; the scenarios' CSV stays a separate file
 * uploaded afterwards. Naming the columns here avoids guessing them again — and
 * a guess is wrong as soon as a file names its own differently. */
export interface ExpectedCsv {
  column_title: string;
  column_system_prompt: string;
  column_opening_message: string;
  /** Optional: the column carrying the seeded history, as JSON. */
  column_history?: string;
  /** Optional: the column carrying the scenario's laboratory note. */
  column_note?: string;
}

/** What is added to an existing run: a sub-matrix, and nothing else.
 *
 * No judge, no scale, no criterion: what cannot be sent cannot drift, and two
 * batches judged differently would no longer be comparable — which is precisely
 * what a matrix exists to allow.
 *
 * Temperature escapes that rule, because it is carried by each cell and not by
 * the run: the old ones keep theirs whatever happens.
 *
 * The number of turns escapes too, but with justification: a conversation
 * already played is never cut short, it can only be lengthened. If it is
 * deepened, it is judged again in full — a verdict on four turns says nothing of
 * the same conversation at eight. Finally, the run's depth stays the same for
 * all its cells: the one asked for. A cell that stopped earlier did so because
 * it had nothing more to give; forcing it beyond would teach nothing, and the
 * mean counts it on an equal footing with the others. */
export interface ExtendRequest {
  /** Scenarios already present to cover again, by their index. */
  scenario_indices: number[];
  /** Fresh scenarios, added after the run's own. */
  new_scenarios: EvalScenario[];
  /** What each judge expects of the scenarios this extension adds, keyed by
   *  `run_judge_id`.
   *
   * Required exactly of the judges that already declare targets, and refused
   * of the others — see `extendTargetsProblem` (`lib/targets.ts`) for the rule
   * and for why it lives beside `extendProblem` rather than inside it.
   *
   * Carries ONLY the new rows, never the whole list: resending the full list
   * would allow rewriting what was expected of rows already played, and a
   * target rewritten after seeing the result is worth nothing. */
  new_targets?: Record<string, JudgeTarget[]>;
  /** Models to cover — already evaluated or not, the distinction is made here. */
  targets: string[];
  /** How many repetitions to add to each pair kept. */
  repetitions: number;
  temperature?: TemperatureSpec | null;
  /** Tools to add to the run's setting.
   *
   * Adding is allowed, redefining is not: a tool taking an existing name would
   * make the cells already played read back as having had this one. */
  new_tools?: ToolSpec[];
  /** The model that serves this run's tools — those it already carries as much
   *  as those `new_tools` adds — when this run does not have one yet.
   *
   * Not only the added tools: a run predating this field may already serve
   * without naming one, and an extension that adds nothing served must then
   * carry it just as much — that is the case the previous line made easy to
   * forget (see CRITICAL 2, `ExtendPanel.buildRequest`, which had nested it
   * under `new_tools.length > 0`).
   *
   * Three cases, and the third is the only surprising one: a run with no world
   * model that receives a served tool must name one, which becomes the run's; a
   * run with no model to which nothing served is added refuses to have one
   * named, a setting with no effect being worse than an absent one; a run that
   * already serves its tools imposes it silently — naming the same one passes, a
   * harmless repetition, naming another is refused, two servers within one run
   * would make its cells incomparable. See `extendProblem`. */
  world?: string | null;
  /** Judges to lay on this run, on top of those it already carries.
   *
   * Always secondary: becoming principal is a second, explicit gesture. Each is
   * born with a pending score row on every conversation of the run, which the
   * catch-up then fills in.
   *
   * Combines with nothing else — no scenario, no model, no deepening. The engine
   * has two distinct passes: `run` plays the fresh cells, `catchup` fills in the
   * missing verdicts on the conversations already finished, and one launch does
   * only one of them. Mixing them would make half the work paid for and not
   * done — see `extendProblem`. */
  new_judges?: WrittenJudgeSpec[];
  /** Do the existing scenarios that had named no tool — hence "all the run's" —
   *  inherit the new ones?
   *
   * Changes nothing about the cells already played, which are done: only what a
   * re-execution of those scenarios would see, covering them again with other
   * models or other attempts. `false` freezes their list on the tools that
   * existed, so that they see again exactly what they have always seen. */
  new_tools_for_existing?: boolean;
  /** The depth wanted for the run. Never below the current one: a conversation
   *  already played is not cut short. Absent leaves the depth as it stands. */
  turns?: number;
  /** The model that plays the user, and its objective — for a run that has
   *  neither.
   *
   * They travel together or not at all: an adversary is a model AND an
   * objective, and half of one would run under a default nobody chose.
   *
   * Three cases, the world model's rule transposed — see `extendProblem`. A run
   * with no adversary that this extension takes beyond one turn must define
   * one, which is what lets a single-turn run be deepened at all rather than
   * written again from scratch. A run that already has one refuses to have
   * either field named: two adversaries within one run would make its cells
   * incomparable, and the run's own would silently win over what was sent —
   * validated, never applied. An extension that leaves the run at one turn
   * refuses them too, the adversary never speaking there.
   *
   * Once written they belong to the run, and play every cell it adds, continues
   * or replays afterwards. */
  adversary?: string | null;
  adversary_prompt?: string;
  /** The attempts to continue up to `turns`, chosen by the grade the judge gave
   *  them: the server finds which ones itself, since it is the one that has the
   *  grades.
   *
   * An arbitrary set and not a rectangle: the attempts of one cell do not all
   * have the same grade, and one deepens what held while leaving what has
   * already given way — `"all"` for every graded attempt of the run, a list of
   * grades to take only those. Absent deepens nothing. */
  deepen?: "all" | number[];
}

/** An entry of `EvalRun.extensions`: what an extension asked for, when, by
 *  whom, through which door, and what it cost — see the migration
 *  `evals/supabase/migrations/20260905203414_run_extensions_log.sql` for the
 *  full reasoning.
 *
 * `cost_before_usd` is the heart of the design: the run's total cost just before
 * this extension applies, never recomputed afterwards. It is what makes each
 * extension's real cost deducible without ever coming back to write — see
 * `extensionsOf` in `run-extensions.ts`. */
export interface RunExtensionLogEntry {
  at: string;
  by: string;
  /** Through which door the extension came in.
   *
   * `"script"` is not a door of the application: it is a write made outside it,
   * by a script holding the service key — the multiple-judges project left one,
   * which added a judge to an existing run. This log being free jsonb, nothing
   * in the database prevented that value, and this type ignored it: `"script"`
   * was in the database without being declared here.
   *
   * Declared rather than forbidden. The past is written and cannot be read back
   * any other way, and denying it let a real `via` slip into code that believed
   * it impossible. The living doors stay `ui` and `mcp`: nothing in the
   * application writes `"script"`. */
  via: "ui" | "mcp" | "script";
  /** The request as it was made. */
  request: ExtendRequest;
  /** The quote computed at that moment. `null` only in theory — `extendRun`
   *  never lays an entry for an extension that adds and deepens nothing, the
   *  only case in which `planExtension` costs nothing. */
  estimate: CostEstimate | null;
  /** The run's total cost just before this extension. `null` when that cost is
   *  itself unknown — a run that has cost nothing yet, or one of whose models
   *  has no tariff — never replaced by 0, which would wrongly assert either
   *  gratuity or a full tariff. */
  cost_before_usd: number | null;
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Written by the experimenter, not produced by a model. */
  seeded?: boolean;
  /** The tools this assistant turn decided to call. */
  tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  /** On a `tool` turn: the tool that "answered". */
  tool_name?: string | null;
  /** On a `tool` turn: the call this result answers. */
  tool_call_id?: string | null;
  /** `content_filter` when the provider blocked the generation. */
  stop_reason?: string | null;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_cache_read: number;
  input_tokens_cache_write: number;
  reasoning_tokens: number;
}

/** A row of `eval_runs`. */
export interface EvalRun {
  id: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  user_email: string;
  label: string | null;
  status: RunStatus;
  error: string | null;
  config: EvalRunConfig;
  notes: string;
  /** Written afterwards, distinct from `notes`, which is the preamble. Never
   *  carried by `config`: a duplication does not take it back. */
  analysis: string;
  /** Published: `/shared/<id>` answers outside a session. Written by the single
   *  route `/api/runs/<id>/publish`. */
  is_public: boolean;
  /** Set aside from the lists and from public reading. Nothing is erased. */
  deleted_at: string | null;
  total_samples: number;
  usage: Record<string, ModelUsage>;
  cost_usd: number | null;
  rejudged_at: string | null;
  /** When the awareness judge was run afterwards, if it was. The configuration
   *  keeps saying what had been asked at launch. */
  awareness_judged_at: string | null;
  execution: string | null;
  /** Where the job ran: on a development machine, or on Cloud Run. */
  origin: "local" | "cloud-run";
  /** The quote computed at launch, to compare with `cost_usd`. null on the runs
   *  predating its recording. */
  estimate: CostEstimate | null;
  /** What this run has undergone since its creation, in order: one entry per
   *  extension, whatever the door — screen or MCP. Empty on a run that has never
   *  been extended. See `RunExtensionLogEntry`. */
  extensions: RunExtensionLogEntry[];
  /** The draft this run came out of, if it comes from one. Several runs may
   *  designate the same: relaunching a draft is expected. With no foreign key —
   *  the provenance survives the draft's disappearance, and the identifier may
   *  therefore designate nothing any more. */
  draft_id: string | null;
  /** Who pressed "launch": the interface, or an MCP tool.
   *
   * No longer bounds an MCP caller's budget — `mcp_launches` takes care of that
   * now, one row per launch rather than one column per run, which an extension
   * demands: it writes on an existing run, which the budget of an agent
   * enlarging it must not confuse with that of another agent, or of a human, who
   * also touched it. This column still answers, and only, "was this run started
   * by an agent?" — a question `mcp_launches` does not ask for an extension,
   * which creates no run. Default `'ui'` in the database: the runs predating
   * this column could never have come from anywhere else. */
  launched_via: "ui" | "mcp";
}

/** A row of `mcp_launches`: a launch that succeeded through an MCP tool, `run`
 *  as much as `extend`.
 *
 * It is this row, and only this row, that the rolling hour's budget sums — see
 * `mcp-budget.ts`. `run_id` designates the run created (`kind: "run"`) or
 * enlarged (`kind: "extend"`); several rows may therefore designate the same
 * run, each by a distinct launch. `quoted_usd` is the quote that decided the
 * launch, never recomputed afterwards: a real cost only exists once the run is
 * finished, and it is not yet at the moment of writing this row. */
export interface McpLaunch {
  id: string;
  user_email: string;
  run_id: string;
  kind: "run" | "extend";
  quoted_usd: number;
  created_at: string;
}

/** A row of `profiles`: the two caps of an agent launched by this person, their
 *  own rather than everyone's — see `profiles.ts`. Created as soon as an
 *  authenticated identity presents itself, through the screen or through MCP;
 *  never deleted, so that a cap lowered does not rise again on its own. */
export interface Profile {
  user_email: string;
  max_usd_per_run: number;
  max_usd_per_hour: number;
  created_at: string;
  /** The scenario writing advice, as this person rewrote it.
   *
   * `null` — the common case — means "use the code's default". The default is
   * never copied here: otherwise improving it would reach nobody, each person
   * carrying the version of the day they signed up. Returning to the default
   * means setting `null` back. */
  scenario_advice: string | null;
  /** The four advice documents, as this person has rewritten them, keyed by
   *  topic — see `AdviceOverrides` in `advice.ts`.
   *
   * `null`, a missing topic, or a blank string all mean "use the code's
   * default". The default is never copied here, for the same reason as
   * `scenario_advice` and `favorite_models`: improving it would stop reaching
   * anyone.
   *
   * One JSON column rather than four text ones, so a fifth document costs no
   * migration. `scenario_advice` above stays the override for the `scenario`
   * topic as long as this one carries none — nobody should lose a text written
   * before the advice was split in four. `overridesOf` (`advice.ts`) holds that
   * rule. */
  advice_overrides: Record<string, string> | null;
  /** The models this person wants offered.
   *
   * `null` — the common case — means "use the code's default", through
   * `favoriteModels` in `favorite-models.ts`. The default is never copied here,
   * for the same reason as `scenario_advice`: enriching it would reach nobody.
   * Bounds only what is OFFERED; a run's validation, for its part, accepts the
   * whole catalogue. */
  favorite_models: string[] | null;
}

/** What `mcp_launches` says of the last hour, for one person: how many launches,
 *  and for what summed quote — see `mcpActivityLastHour` in `runs.ts`. Serves
 *  the profile page, never a budget decision, which keeps only the amount. */
export interface ProfileActivity {
  count: number;
  usd: number;
}

/** A row of `eval_samples`: a cell of the matrix.
 *
 * Since the multiple judges, this interface no longer carries a conversation's
 * grade: `score`, `justification`, `awareness_score`, `awareness_justification`
 * and `awareness_error` were removed from here *because* the migration
 * `evals/supabase/migrations/20260906093000_drop_eval_samples_score_columns.sql`
 * (polaris-supabase repository) dropped them from the table — leaving them here
 * would have let code already dead at run time against the real database compile
 * quietly. What a judge returned on a conversation now lives in `JudgeScore`,
 * one row per (judge, conversation); see `matrix.ts`, `awareness.ts` and
 * `deepen-counts.ts` for the shape the join takes on the reading side
 * (`MatrixSample`, `JudgeVerdict`, `DeepenSample`). */
export interface EvalSample {
  id: string;
  run_id: string;
  scenario_index: number;
  scenario_title: string;
  target_model: string;
  repetition: number;
  status: SampleStatus;
  temperature: number | null;
  /** How many turns this cell really played.
   *
   * `null` as long as it has not run. A cell shorter than the run's depth is not
   * incomplete: it settled there, and pushing it further would have taught
   * nothing. */
  turns_done: number | null;
  messages: Message[];
  /** Did the conversation's execution fail — never the judge, which has its own
   *  error column on `JudgeScore`. `null` for a cell that finished playing
   *  normally, whatever the judge's verdict afterwards. */
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** Tokens consumed by this cell, per model. */
  usage: Record<string, ModelUsage>;
  /** What this cell cost, or null if one of the models used has no tariff. */
  cost_usd: number | null;
}

/** Where a run stands, counted on its cells. */
export interface Progress {
  total: number;
  done: number;
  running: number;
  pending: number;
  errored: number;
  cancelled: number;
}

/** A cell of the matrix: what a model obtained on a scenario.
 *
 * Four ways of having no grade, and they do not merge: a cell handled without a
 * grade (a blocked conversation, an answer off the scale), a cell that broke
 * down, a cell never started because the run was stopped, and a cell still to
 * do. Mixing them would erase the difference between "we do not know", "it
 * broke" and "we decided not to do it". */
export interface Cell {
  judged: number;
  unjudged: number;
  errored: number;
  /** Never started: the run was stopped before reaching it. */
  cancelled: number;
  /** Graded "not applicable": the judge answered, but out of the mean. */
  excluded: number;
  pending: number;
  mean: number | null;
  /** How many times each grade was given in this cell.
   *
   * A mean does not distinguish a consensus from a split: 1.8 may be five close
   * attempts or one 0 and four 2s, and on a behavioural scenario that is the
   * whole difference between "the model hesitates" and "the model does two
   * opposite things depending on the time".
   *
   * Counts only what enters the mean: a "not applicable" is an answer, not a
   * grade, and lives in `excluded`. */
  grades: Record<string, number>;
  /** The sum of what the attempts of this matrix cell cost. */
  cost_usd: number;
  /** How many attempts of this cell showed they knew they were being tested, at
   *  the same threshold as the run's indicator (AWARENESS_ALARM) and not another:
   *  the sum of this count over every cell must always land on the figure the
   *  indicator announces, without which the two would contradict each other on
   *  the same screen. */
  awareness_flagged: number;
}

/** A run as the WEB LIST shows it — never its whole configuration.
 *
 * `RunSummary`, just below, carries the complete `EvalRun` because the MCP search
 * digs through the notes, the analysis and the criterion of each run. The
 * screen, for its part, reads only three things of the configuration: the scale,
 * the first scenario's title, and two counts.
 *
 * The gap is not theoretical. Over today's thirteen runs, the complete
 * configuration weighs 72 KB against 3.3 KB for the columns displayed — 95% of
 * the payload for three values read, the bulk being the system prompts and the
 * opening messages of each scenario. And that payload went out every three
 * seconds as long as a run was going.
 *
 * Hence two shapes and two loads, rather than a single widened one: see
 * `loadRunList` and `loadRuns` (`lib/runs.ts`). */
export interface RunListRun {
  id: string;
  created_at: string;
  user_email: string;
  label: string | null;
  status: RunStatus;
  cost_usd: number | null;
  is_public: boolean;
  origin: "local" | "cloud-run";
  /** Who pressed the button, for THIS run — never for what was added to it
   *  afterwards. A draft submitted by an agent then launched by a human click is
   *  therefore worth `ui`: it is the launch that counts, not the writing. The
   *  extensions, for their part, create no run and are counted elsewhere
   *  (`mcp_launches`) — see `EvalRun.launched_via`. */
  launched_via: "ui" | "mcp";
  /** The principal judge's scale: the list draws the displayed bounds from it. */
  rubric: RubricLevel[];
  /** The first scenario's title — the fallback label of a run with no name. The
   *  first only, not the others: it is all that is displayed. */
  first_scenario_title: string | null;
  /** Counted on the cells, not on the configuration: that one is no longer
   *  brought back, and the matrix is written whole at the run's creation. */
  scenario_count: number;
  target_count: number;
}

/** A row of the web list. Same shape as `RunSummary` around a reduced run, so
 *  that the page only has to change where it read `config`. */
export interface RunListItem {
  run: RunListRun;
  progress: Progress;
  mean: number | null;
  /** Like `RunSummary.repetitions`: the fewest and the most attempts per cell. */
  repetitions: [number, number];
}

/** A run in the list: enough to sort and decide whether to open it.
 *
 * No longer serves the web list since `RunListItem` above — only the MCP search,
 * which needs the whole text of each run. */
export interface RunSummary {
  run: EvalRun;
  progress: Progress;
  mean: number | null;
  /** How many attempts per cell: the fewest, the most.
   *
   * Two figures and not one, because a run completed in several goes does not
   * advance at the same pace everywhere. `config.repetitions` says no more than
   * what had been asked for the last batch. */
  repetitions: [number, number];
}

/** A run submitted by an agent, saved without being launched.
 *
 * The gesture of launching stays a human click: that is the whole reason for
 * this table rather than a run created directly. */
/** What every draft carries, whatever it proposes. */
interface DraftCommon {
  id: string;
  csv_text: string | null;
  created_by: string;
  created_at: string;
  /** `manual`: saved from the form, possibly incomplete — one comes back to it
   *  later. `mcp`: submitted by an agent, hence valid at the moment it was
   *  written. */
  origin: "manual" | "mcp";
  /** Discarded: leaves the list, and its address no longer answers. */
  deleted_at: string | null;
  /** Launched: leaves the list, but its address stays open — one may want to
   *  relaunch the same thing. */
  launched_at: string | null;
  /** What it produced, if it was launched. Answers after the fact "where does
   *  this run come from". */
  launched_run_id: string | null;
}

/** A run to launch. */
export interface RunDraft extends DraftCommon {
  kind: "run";
  config: EvalRunConfig;
  extends_run_id: null;
}

/** A sub-matrix to add to an existing run.
 *
 * `config` carries an `ExtendRequest`: it is the same column in the database, and
 * `kind` says how to read it. The discriminated union does the rest — reading an
 * `EvalRunConfig` on an extension draft does not compile.
 *
 * Nothing is applied to the run as long as it is not launched, proposed tools
 * included: a draft one throws away must leave the run intact. */
export interface ExtendDraft extends DraftCommon {
  kind: "extend";
  config: ExtendRequest;
  extends_run_id: string;
}

export type Draft = RunDraft | ExtendDraft;

/** A draft as the reading route returns it: its content, plus a verdict only the
 *  session can settle.
 *
 * The browser never knows the current user's address — it is the route that ties
 * it to the session — so it cannot compare `created_by` to whoever is looking
 * itself. `mine` carries that verdict already settled: it is what makes it
 * possible to announce "Save as my own copy" before even saving, rather than
 * discovering it afterwards through a silent redirection. */
export type DraftRead = Draft & { mine: boolean };

/** An open run: its configuration, its cells, its matrix. */
export interface RunDetail {
  run: EvalRun;
  samples: EvalSample[];
  progress: Progress;
  source_csv_available: boolean;
  /** How many rows of `judge_scores` are left to fill on this run — for any
   *  living judge, on a conversation already finished. See
   *  `catchupMissingTotal`, `lib/runs.ts`: computed on demand only, and never
   *  without checking that the conversation aimed at really is `done` — the
   *  engine (`catchup_dataset`, `backend/playground/batch_job.py`) never catches
   *  up a conversation that is not, and a count forgetting that would announce
   *  work a catch-up would never do. */
  catchup_missing: number;
  /** The run's living judges, with their verdict on each conversation — see
   *  `RunJudgeView`. `undefined` when not asked for (see `loadRun`'s
   *  `withJudges`): almost every caller of `loadRun` never looks at the judges,
   *  only at the run's existence. */
  judges?: RunJudgeView[];
  /** The results of tools served from the world, with the check's verdict on
   *  each — see `lib/served.ts`. `undefined` when not asked for (see
   *  `withToolResults`): almost every run has none, and the list must not pay a
   *  read per run for a table most often empty. */
  tool_results?: import("./served").ToolResultRow[];
}

export interface ModelOption {
  id: string;
  label: string;
  /** Price in dollars per million tokens, or null if the model has no tariff. */
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  /** Does the provider take into account the temperature it is sent?
   *
   * `false` does not mean the call fails: Claude 4.7 and above run in adaptive
   * thinking and refuse the parameter, `inspect_ai` removes it and the call
   * succeeds without it. That is what makes the trap treacherous — a temperature
   * sweep on those models measures nothing but noise, and nothing in the answer
   * says so. */
  honours_temperature: boolean;
  /** Is this model among the favourites of whoever is looking?
   *
   * Laid by `catalog()` from the list it is passed, never read from the shared
   * file: the favourites are one person's own, the catalogue is common to
   * everyone. */
  favorite: boolean;
}

export interface ProviderInfo {
  id: string;
  label: string;
  env_vars: string[];
  key_present: boolean;
  models: ModelOption[];
}

/** What a model costs in a run, and on what assumption. */
/** In what capacity a model is called in a run.
 *
 * The code's own words — those of the YAML, of `models.world` and of the error
 * messages — so that what one reads in the quote is found as it stands in the
 * file one edits.
 *
 * No `awareness`: the awareness judge runs on `models.judge`, at the same tariff
 * and on the same conversation as an ordinary judge. It is counted in that
 * model's `judge` row, and it is the row's label that names it. */
export type ModelRole =
  | "evaluated"
  | "adversary"
  | "judge"
  | "world"
  | "check";

/** What a model costs **in a given capacity**, and on what assumption.
 *
 * One row per (role, model), and not per model: a `claude-sonnet-5` evaluated and
 * judge in the same run is the ordinary configuration, and merging its two
 * spends made it impossible to see what a setting costs. See
 * docs/superpowers/specs/2026-09-08-devis-par-role-design.md. */
export interface ModelCost {
  model: string;
  /** Absent on the quotes taken before this split — they are stored on the runs
   *  and the drafts, and are never recomputed: the quote shown on a launched run
   *  must stay the one taken at launch, without which the gap to the real cost
   *  would stop measuring the estimate's drift and start measuring the movement
   *  of the tariffs. A row with no role shows with no label. */
  role?: ModelRole;
  /** The model calls this row counts.
   *
   * Optional for the same reason as `role`, and to be treated with the same
   * mistrust: a row read back from a quote stored before this split does not
   * carry it. If the type said otherwise, an addition would find `undefined`
   * there and return `NaN` — a false total, shown without flinching. */
  calls?: number;
  /** Is this number a bet? True for `world` and `check` only, and for two
   *  reasons that work in the same direction: nothing declares how many tools
   *  the evaluated model will call, and the `tool_results` cache removes most of
   *  the remaining calls. The figure is therefore a **ceiling** — never a
   *  floor. */
  assumed?: boolean;
  input_tokens: number;
  output_tokens: number;
  response_tokens: number;
  /** null if the model has no known tariff. */
  usd: number | null;
}

/** What output length a quote rests on. Twin of `LengthAssumption` on the Python
 *  side — the two must accept exactly the same shapes. */
export interface LengthAssumption {
  /** The evaluated model's answers: one number for every scenario, or one per
   *  scenario in the order of `config.scenarios`. */
  answer?: number | number[] | null;
  /** The adversary's turns, which depend on its instruction and not on the
   *  scenario. Absent, it takes the run's declared length. */
  adversary?: number | null;
}

export interface CostEstimate {
  /** The assumed length, or null if it varies from one scenario to another. */
  response_tokens: number | null;
  usd: number;
  eur: number;
  min_usd: number;
  max_usd: number;
  min_eur: number;
  max_eur: number;
  conversations: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  /** The details, from the dearest to the cheapest. It is what explains a total. */
  per_model: ModelCost[];
  unpriced_models: string[];
}

/** A tag, and the colour it will keep. */
export interface Tag {
  id: number;
  label: string;
  color: string;
}
