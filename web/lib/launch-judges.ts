// The rows of the three judge tables, to be created for a fresh run.
//
// Separated from `runs.ts` for the same reason as `cells.ts`: it is the only
// part of this mechanism worth testing on its own — the rest is nothing but
// Supabase writes — and `runs.ts` imports `server-only`, which breaks the
// import under `node --test`. See the comment at the head of `cells.ts`.
import { randomUUID } from "node:crypto";
import { nameJudge, type TakenNames } from "./judge-name.ts";
import type {
  EvalRunConfig,
  JudgeGrades,
  JudgeSpec,
  JudgeSystemTypeColumn,
  JudgeTarget,
  RubricLevel,
} from "./types";

/** A row of `judges` as it is born, before insertion. */
export interface NewJudgeRow {
  id: string;
  /** What a person reads, and the handle MCP addresses. Both are settled
   *  before the insert rather than left to the database: they have to avoid the
   *  names already taken AND one another, and only the caller knows both. See
   *  `nameJudge` (`judge-name.ts`). */
  label: string;
  slug: string;
  criterion: string | null;
  rubric: RubricLevel[] | null;
  /** Whose turns this judge grades. Written explicitly, never left to the
   *  column's default, for the same reason `sees_system_prompt` is: a row built
   *  here describes in full the judge it creates. */
  grades: JudgeGrades;
  sees_adversary_goals: boolean;
  system_type: JudgeSystemTypeColumn;
  /** Whether this judge sees the scenario's system prompt — see
   *  `Judge.sees_system_prompt`. Always set explicitly, never left to the
   *  column's default: a row built here describes in full the judge it creates,
   *  and a system judge must be `true` by construction. */
  sees_system_prompt: boolean;
  created_by: string;
}

/** A row of `run_judges` as it is born, before insertion.
 *
 * `system_type` faithfully copies that of the judge it points at — see the
 * comment on `RunJudge` in `types.ts` for why this copy exists and why it must
 * never depart from it: it is what the composite foreign key
 * `run_judges_judge_fk` checks on insertion. */
export interface NewRunJudgeRow {
  id: string;
  run_id: string;
  judge_id: string;
  system_type: JudgeSystemTypeColumn;
  /** The model that will grade this run. On the link since judges became a
   *  library: the same question put to two models is one judge, and it is the
   *  pair that gets calibrated. See `RunJudge.model`. */
  model: string;
  is_principal: boolean;
  /** What this judge expects of each scenario — see `RunJudge.targets` for why
   *  this lives on the link and not on the scenario. `null` when the
   *  configuration carried none: the writer was exploring. */
  targets: JudgeTarget[] | null;
}

/** A row of `judge_scores` as it is born: pending, with no verdict. `status`,
 *  `justification` and the rest take their default in the database — see the
 *  migration. */
export interface NewJudgeScoreRow {
  run_judge_id: string;
  sample_id: string;
  run_id: string;
}

export interface LaunchJudges {
  judges: NewJudgeRow[];
  runJudges: NewRunJudgeRow[];
  judgeScores: NewJudgeScoreRow[];
}

/** A `JudgeSpec` — an entry of `config.judges` at launch, or the body posted
 *  to `.../judges` to add a judge afterwards (`addJudge`, `runs.ts`) — reduced
 *  to a row of `judges` ready to insert.
 *
 * Always ordinary: a `JudgeSpec` never carries a system type, see its
 * docstring. The model no longer appears here at all: it belongs to the link,
 * and `judgesForLaunch`/`addJudge` resolve `spec.model ?? config.models.judge`
 * where they build it.
 *
 * `taken` is what must not be collided with, and this function ADDS to it: two
 * judges written in the same breath with the same criterion must not both claim
 * the same name, and the insert would be refused after the form was filled.
 *
 * Shared by `judgesForLaunch`, further down, and by `addJudge`: the two
 * gestures create the same kind of judge from the same shape, and a duplicated
 * definition could have diverged. */
export function judgeRowFromSpec(
  spec: JudgeSpec,
  createdBy: string,
  taken: TakenNames,
  newId: () => string = randomUUID,
): NewJudgeRow {
  const { label, slug } = nameJudge(spec.label, spec.criterion, "ordinary", taken);
  return {
    id: newId(),
    label,
    slug,
    criterion: spec.criterion,
    rubric: spec.rubric,
    // Written by the form's own field once it exists. Until then every judge
    // written by hand grades the assistant, which is what all of them did
    // before this column.
    grades: "assistant",
    sees_adversary_goals: false,
    system_type: "ordinary",
    // Absent means `true` — the behaviour from before this field, so that adding
    // a judge without thinking about it changes nothing.
    sees_system_prompt: spec.sees_system_prompt !== false,
    created_by: createdBy,
  };
}

/** The rows of the three judge tables to create for a fresh run.
 *
 * Same gesture as `cellsForRun` for the matrix: everything is created in
 * advance, pending — the job only fills in, never creates. See the design,
 * section « Les lignes de score sont créées d'avance »
 * (docs/superpowers/specs/2026-09-06-juges-multiples.md).
 *
 * One judge per source, in this order:
 * - the principal, from `config.criterion`, `config.rubric` and
 *   `config.models.judge` — the old shape, still accepted;
 * - one per entry of `config.judges`, the ordinary secondaries — see
 *   `JudgeSpec`;
 * - an awareness judge, of system type, if `config.check_eval_awareness` is
 *   not explicitly `false`;
 * - an adversary-fidelity judge, of system type, if
 *   `config.check_adversary_fidelity` is explicitly `true` — never from
 *   `config.judges`, which carries no system judge at all: see the docstring of
 *   `JudgeSpec` in `types.ts`.
 *
 * Then one row of `judge_scores` per (link, conversation): each judge above
 * crossed with each element of `sampleIds`.
 *
 * The identifiers of `judges` and `run_judges` are made here rather than left
 * to the database: a row of `judge_scores` must reference its link before that
 * link really exists in the database, which demands building the three tables
 * at once, in memory, before the first write. `newId` — `crypto.randomUUID` by
 * default — is injected so that the tests produce deterministic output.
 *
 * `runId` and `sampleIds` are supplied by the caller: the run and its cells
 * must already exist in the database — their identifiers are generated there —
 * before this function is called. */
export function judgesForLaunch(
  config: EvalRunConfig,
  runId: string,
  createdBy: string,
  sampleIds: string[],
  taken: TakenNames = { labels: new Set(), slugs: new Set() },
  newId: () => string = randomUUID,
): LaunchJudges {
  const judges: NewJudgeRow[] = [];
  const runJudges: NewRunJudgeRow[] = [];

  // `targets` travels here and not on `NewJudgeRow`: the target belongs to the
  // LINK, not to the judge. The same judge, reused on another run, looks at
  // other scenarios there.
  function link(
    judge: NewJudgeRow,
    isPrincipal: boolean,
    model: string,
    targets: JudgeTarget[] | null = null,
  ): void {
    judges.push(judge);
    runJudges.push({
      id: newId(),
      run_id: runId,
      judge_id: judge.id,
      system_type: judge.system_type,
      model,
      is_principal: isPrincipal,
      targets,
    });
  }

  link(
    {
      id: newId(),
      ...nameJudge(config.judge_label, config.criterion, "ordinary", taken),
      criterion: config.criterion,
      rubric: config.rubric,
      grades: "assistant",
      sees_adversary_goals: false,
        // A sentinel, never `null`: see `JudgeSystemTypeColumn` in `types.ts`.
        // "Is this judge a system one?" is now read by comparing this value to
        // `"ordinary"`, never again by testing an absence — a nullity test
        // restored here would make every judge pass for a system one, the column
        // never being null in the database any more.
      system_type: "ordinary",
      sees_system_prompt: config.sees_system_prompt !== false,
      created_by: createdBy,
    },
    true,
    config.models.judge,
    config.targets ?? null,
  );

  for (const spec of config.judges ?? []) {
    link(
      judgeRowFromSpec(spec, createdBy, taken, newId),
      false,
      spec.model ?? config.models.judge,
      spec.targets ?? null,
    );
  }

  if (config.check_eval_awareness !== false) {
    link(
      {
        id: newId(),
        ...nameJudge(null, null, "awake", taken),
        criterion: null,
        rubric: null,
        grades: "assistant",
        sees_adversary_goals: false,
        system_type: "awake",
        // The eval-awareness check MUST see the system prompt: its rule is "if
        // the assistant was simply told it was a test, the answer is 1", which
        // it cannot apply without knowing what it was told. Never configurable,
        // unlike an ordinary judge.
        sees_system_prompt: true,
        created_by: createdBy,
      },
      false,
      config.models.judge,
      // Its question does not belong to the user, so neither does its target.
      null,
    );
  }

  // Opt in, where awareness is opt out. It grades a text the experimenter
  // wrote rather than the model under test, and it is meaningless below two
  // turns: `configProblem` refuses the pair, so nothing here has to check it
  // again.
  if (config.check_adversary_fidelity === true) {
    link(
      {
        id: newId(),
        ...nameJudge(null, null, "faithful_adversary", taken),
        criterion: null,
        rubric: null,
        // The one judge here that looks at the user's turns rather than the
        // assistant's, which is exactly what this field exists to say.
        grades: "adversary",
        sees_adversary_goals: true,
        system_type: "faithful_adversary",
        // It grades the adversary's turns against the objective it was given.
        // The evaluated model's instructions are part of the situation the
        // adversary was playing in, so it reads them like any other judge.
        sees_system_prompt: true,
        created_by: createdBy,
      },
      false,
      config.models.judge,
      // Its question does not belong to the user, so neither does its target.
      null,
    );
  }

  const judgeScores = judgeScoresForSamples(
    runId,
    runJudges.map((runJudge) => runJudge.id),
    sampleIds,
  );

  return { judges, runJudges, judgeScores };
}

/** The rows of `judge_scores` to create for fresh cells joining a run already
 *  launched — the same cross product (each living judge of the run × each
 *  conversation) that `judgesForLaunch` builds above for a fresh run, reduced
 *  to the case where the judges already exist and only the conversations are
 *  new.
 *
 * Used by `extendRun` (`runs.ts`) for the cells an extension adds. Without
 * these rows, `write_judge_score` (the engine, on the `supabase_store.py` side)
 * would find nothing to update: it only does a targeted `UPDATE` on
 * `(run_judge_id, sample_id)`, never an `INSERT` — the row is supposed to exist
 * already, `pending`, ever since the conversation was laid down. A judge's
 * verdict on a fresh cell one had forgotten to pre-create here would therefore
 * be lost in silence: the write would touch no row, without raising an error. */
export function judgeScoresForSamples(
  runId: string,
  runJudgeIds: string[],
  sampleIds: string[],
): NewJudgeScoreRow[] {
  const judgeScores: NewJudgeScoreRow[] = [];
  for (const runJudgeId of runJudgeIds) {
    for (const sampleId of sampleIds) {
      judgeScores.push({
        run_judge_id: runJudgeId,
        sample_id: sampleId,
        run_id: runId,
      });
    }
  }
  return judgeScores;
}
