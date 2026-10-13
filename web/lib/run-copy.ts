// Copying a run: a new, independent run holding the source's conversations,
// grades and cell costs, whole or reduced to some scenarios, target models,
// judges and repetitions.
//
// Nothing is replayed and nothing is spent. The copy keeps its source's
// origin for good: a copy of a run the playground played is extended by the
// playground, a copy of an imported run by import. Afterwards the two runs
// share nothing but the copy's record of where it came from (`copied_from`,
// `copy_scope`, `money_saved`). See
// docs/superpowers/specs/2026-10-13-run-copies-and-judge-notes-design.md.
//
// Pure, like `cells.ts`: everything decided here is decided before the first
// write, and `copyRun` (`runs.ts`) only writes what this returns.
import type {
  CopyScope,
  EvalRun,
  EvalRunConfig,
  EvalSample,
  Judge,
  JudgeScore,
  JudgeSpec,
  JudgeTarget,
  RunJudge,
} from "./types";

/** What a caller asks to copy. Each part absent takes all of it. */
export interface CopyRequest {
  scenario_indices?: number[];
  target_models?: string[];
  run_judge_ids?: string[];
  repetitions?: number[];
}

type SourceSample = Omit<EvalSample, "run_id">;

/** A live link of the source, with the judge it points at. */
export type SourceLink = Pick<
  RunJudge,
  "id" | "judge_id" | "system_type" | "is_principal" | "model" | "targets" | "judge_note"
> & {
  judge: Pick<
    Judge,
    | "criterion"
    | "rubric"
    | "label"
    | "grades"
    | "sees_adversary_goals"
    | "sees_system_prompt"
    | "higher_is_better"
  >;
};

export interface CopySource {
  run: Pick<EvalRun, "id" | "label" | "notes" | "status" | "origin" | "config">;
  samples: SourceSample[];
  /** The source's LIVE links only; an unlinked judge is not copied. */
  links: SourceLink[];
  scores: Pick<
    JudgeScore,
    "run_judge_id" | "sample_id" | "status" | "score" | "justification" | "error"
  >[];
  /** Rows of `tool_results`, whatever their other columns: only
   *  `scenario_index` is rewritten. */
  toolResults: ({ scenario_index: number } & Record<string, unknown>)[];
}

export interface CopyPlan {
  config: EvalRunConfig;
  scope: CopyScope;
  samples: (SourceSample & { id: string })[];
  links: (Omit<SourceLink, "judge"> & { id: string })[];
  scores: CopySource["scores"];
  toolResults: CopySource["toolResults"];
  /** What replaying the copied cells would have cost, and the copy's cost:
   *  `null` when a finished copied cell has no known cost. */
  moneySaved: number | null;
}

/** A selection kept in the source's order, or why it cannot be. */
function chosen<T>(
  all: readonly T[],
  asked: readonly T[] | undefined,
  what: string,
): T[] | string {
  if (asked === undefined) return [...all];
  if (asked.length === 0) return `name at least one ${what}, or leave ${what}s out to copy them all`;
  const unknown = asked.filter((item) => !all.includes(item));
  if (unknown.length > 0) {
    return `the run holds no ${what} ${unknown.map((item) => JSON.stringify(item)).join(", ")}`;
  }
  return all.filter((item) => asked.includes(item));
}

function restricted(
  targets: JudgeTarget[] | null | undefined,
  scenarios: number[],
): JudgeTarget[] | null {
  return targets ? scenarios.map((index) => targets[index]) : null;
}

function roundUsd(amount: number): number {
  return Math.round(amount * 1e6) / 1e6;
}

/** Everything a copy of `source` limited to `request` writes, or why it
 *  cannot be made. `newId` mints the ids of the copied cells and links. */
export function planCopy(
  source: CopySource,
  request: CopyRequest,
  newId: () => string,
): CopyPlan | { problem: string } {
  const { run } = source;
  if (run.status === "triggered" || run.status === "running") {
    return { problem: "This run is still going. Wait for it to finish, then copy it." };
  }

  const scenarios = chosen(
    run.config.scenarios.map((_, index) => index),
    request.scenario_indices,
    "scenario",
  );
  if (typeof scenarios === "string") return { problem: scenarios };

  const targetModels = chosen(run.config.models.targets, request.target_models, "target model");
  if (typeof targetModels === "string") return { problem: targetModels };

  const played = [...new Set(source.samples.map((sample) => sample.repetition))].sort(
    (a, b) => a - b,
  );
  const repetitions = chosen(played, request.repetitions, "repetition");
  if (typeof repetitions === "string") return { problem: repetitions };

  const links = chosen(
    source.links.map((link) => link.id),
    request.run_judge_ids,
    "judge",
  );
  if (typeof links === "string") return { problem: links };
  const kept = source.links.filter((link) => links.includes(link.id));
  const principal = kept.find((link) => link.is_principal);
  if (!principal) {
    return {
      problem:
        "The principal judge is always copied: a run cannot exist without one. Keep it among the judges.",
    };
  }

  const newScenario = new Map(scenarios.map((old, index) => [old, index]));
  const newRepetition = new Map(repetitions.map((old, index) => [old, index]));

  const samples = source.samples
    .filter(
      (sample) =>
        newScenario.has(sample.scenario_index) &&
        targetModels.includes(sample.target_model) &&
        newRepetition.has(sample.repetition),
    )
    .map((sample) => ({
      ...sample,
      id: newId(),
      scenario_index: newScenario.get(sample.scenario_index)!,
      repetition: newRepetition.get(sample.repetition)!,
      sourceId: sample.id,
    }));

  const newLinks = kept.map((link) => ({
    id: newId(),
    judge_id: link.judge_id,
    system_type: link.system_type,
    is_principal: link.is_principal,
    model: link.model,
    targets: restricted(link.targets, scenarios),
    judge_note: link.judge_note,
    sourceId: link.id,
  }));

  const byPair = new Map(
    source.scores.map((row) => [`${row.run_judge_id}|${row.sample_id}`, row]),
  );
  const scores = newLinks.flatMap((link) =>
    samples.map((sample) => {
      const row = byPair.get(`${link.sourceId}|${sample.sourceId}`);
      return {
        run_judge_id: link.id,
        sample_id: sample.id,
        status: row?.status ?? ("pending" as const),
        score: row?.score ?? null,
        justification: row?.justification ?? "",
        error: row?.error ?? null,
      };
    }),
  );

  // Unknown as soon as one finished cell has no cost, as a run's own cost is:
  // a partial sum would read as the whole. A failed cell without one costs
  // nothing, like everywhere else.
  let moneySaved: number | null = 0;
  for (const sample of samples) {
    if (sample.cost_usd === null) {
      if (sample.status === "done") moneySaved = null;
      continue;
    }
    if (moneySaved !== null) moneySaved += sample.cost_usd;
  }

  const secondaries = kept.filter(
    (link) => !link.is_principal && link.system_type === "ordinary",
  );
  const config: EvalRunConfig = {
    ...run.config,
    scenarios: scenarios.map((index) => run.config.scenarios[index]),
    criterion: principal.judge.criterion ?? run.config.criterion,
    rubric: principal.judge.rubric ?? run.config.rubric,
    targets: restricted(principal.targets, scenarios),
    judge_note: principal.judge_note,
    repetitions: repetitions.length,
    models: { ...run.config.models, targets: targetModels, judge: principal.model },
    judges: secondaries.map(
      (link): JudgeSpec => ({
        criterion: link.judge.criterion ?? "",
        rubric: link.judge.rubric ?? [],
        model: link.model,
        label: link.judge.label,
        grades: link.judge.grades,
        sees_adversary_goals: link.judge.sees_adversary_goals,
        sees_system_prompt: link.judge.sees_system_prompt,
        higher_is_better: link.judge.higher_is_better,
        ...(link.targets ? { targets: restricted(link.targets, scenarios) } : {}),
        ...(link.judge_note ? { judge_note: link.judge_note } : {}),
      }),
    ),
    check_eval_awareness: kept.some((link) => link.system_type === "awake"),
    check_adversary_fidelity: kept.some((link) => link.system_type === "faithful_adversary"),
  };
  if (!config.targets) delete config.targets;
  if (!config.judge_note) delete config.judge_note;

  return {
    config,
    scope: {
      scenarios,
      target_models: targetModels,
      run_judge_ids: kept.map((link) => link.id),
      repetitions,
    },
    samples: samples.map(({ sourceId: _sourceId, ...sample }) => sample),
    links: newLinks.map(({ sourceId: _sourceId, ...link }) => link),
    scores,
    toolResults: source.toolResults
      .filter((row) => newScenario.has(row.scenario_index))
      .map((row) => ({ ...row, scenario_index: newScenario.get(row.scenario_index)! })),
    moneySaved: moneySaved === null ? null : roundUsd(moneySaved),
  };
}
