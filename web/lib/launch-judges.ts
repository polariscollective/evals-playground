// The rows of the three judge tables, to be created for a fresh run.
//
// Separated from `runs.ts` for the same reason as `cells.ts`: it is the only
// part of this mechanism worth testing on its own — the rest is nothing but
// Supabase writes — and `runs.ts` imports `server-only`, which breaks the
// import under `node --test`. See the comment at the head of `cells.ts`.
import { randomUUID } from "node:crypto";
import type {
  EvalRunConfig,
  JudgeSpec,
  JudgeSystemTypeColumn,
  JudgeTarget,
  RubricLevel,
} from "./types";

/** A row of `judges` as it is born, before insertion. */
export interface NewJudgeRow {
  id: string;
  criterion: string | null;
  rubric: RubricLevel[] | null;
  model: string;
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
 * docstring. `defaultModel` takes the run's model when the entry does not name
 * one — see `JudgeSpec.model`.
 *
 * Shared by `judgesForLaunch`, further down, and by `addJudge`: the two
 * gestures create the same kind of judge from the same shape, and a duplicated
 * definition could have diverged. */
export function judgeRowFromSpec(
  spec: JudgeSpec,
  defaultModel: string,
  createdBy: string,
  newId: () => string = randomUUID,
): NewJudgeRow {
  return {
    id: newId(),
    criterion: spec.criterion,
    rubric: spec.rubric,
    model: spec.model ?? defaultModel,
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
 *   not explicitly `false` — never from `config.judges`, which never carries
 *   one: see the docstring of `JudgeSpec` in `types.ts`.
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
    targets: JudgeTarget[] | null = null,
  ): void {
    judges.push(judge);
    runJudges.push({
      id: newId(),
      run_id: runId,
      judge_id: judge.id,
      system_type: judge.system_type,
      is_principal: isPrincipal,
      targets,
    });
  }

  link(
    {
      id: newId(),
      criterion: config.criterion,
      rubric: config.rubric,
      model: config.models.judge,
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
    config.targets ?? null,
  );

  for (const spec of config.judges ?? []) {
    link(
      judgeRowFromSpec(spec, config.models.judge, createdBy, newId),
      false,
      spec.targets ?? null,
    );
  }

  if (config.check_eval_awareness !== false) {
    link(
      {
        id: newId(),
        criterion: null,
        rubric: null,
        model: config.models.judge,
        system_type: "awake",
        // The eval-awareness check MUST see the system prompt: its rule is "if
        // the assistant was simply told it was a test, the answer is 1", which
        // it cannot apply without knowing what it was told. Never configurable,
        // unlike an ordinary judge.
        sees_system_prompt: true,
        created_by: createdBy,
      },
      false,
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
