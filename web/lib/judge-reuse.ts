// Reusing a judge: what a configuration NAMES rather than describes.
//
// Apart from `launch-judges.ts`, which builds the rows to insert, for one
// reason: this file is imported by the browser. The launch form quotes a run
// whose judges are named, and quoting means settling the handles first — the
// same settling the server does, and it has to be the same code, or the
// announced price and the recorded one would part company. `launch-judges.ts`
// imports `node:crypto` and cannot cross that line.
//
// See the design, docs/superpowers/specs/2026-09-10-reusing-a-judge-design.md.
import { targetsProblem } from "./targets.ts";
import type {
  EvalRunConfig,
  Judge,
  JudgeGrades,
  JudgeSpec,
  JudgeSystemType,
  JudgeTarget,
  RubricLevel,
  WrittenRunConfig,
} from "./types";

/** The judges a configuration does not describe: the ones it names, and the two
 *  system rows.
 *
 * Read from the database by `reusedJudges` (`lib/runs.ts`) and handed down here
 * so that everything below stays a pure function of its arguments, testable
 * without a database — the same reason `takenJudgeNames` is read there and
 * passed in rather than looked up here.
 *
 * `secondary` runs parallel to `config.judges`, one entry each, `null` where
 * that entry describes its judge instead of naming one. Positions rather than
 * handles: an entry knows which judge it is by where it sits, and two entries
 * naming the same judge are refused long before this (`configProblem`). */
export interface ReusedJudges {
  principal: Judge | null;
  secondary: (Judge | null)[];
  /** The seeded system judges, by type — see the migration
   *  `20260910170000_seed_the_system_judges.sql` (polaris-supabase). Absent
   *  means the migration has not run: `judgesForLaunch` says so rather than
   *  minting a second row, which is exactly what the seeding was for. */
  system: Partial<Record<JudgeSystemType, Judge>>;
}

/** Nothing named and nothing seeded: what a caller that resolves no judge hands
 *  down, and what the tests of the old shape use. */
export const NO_REUSE: ReusedJudges = {
  principal: null,
  secondary: [],
  system: {},
};

/** What is wrong with the judges a configuration NAMES, once they have been
 *  looked up, or null if they hold.
 *
 * The half of the checking that needs the database. `configProblem` has already
 * said everything a handle can be wrong about on its own — its shape, a
 * description written beside it, the same one named twice. What is left needs
 * the judge itself: whether it exists, whether it is one of the two the
 * checkboxes own, and the two rules that cross the judge with the run it is
 * about to grade.
 *
 * `found` holds every judge the handles resolved to, by handle. A handle absent
 * from it is a handle nothing answers to.
 *
 * Pure, so that it is tested without a database — `reusedJudges` (`runs.ts`)
 * does the reading and hands the result here. */
export function reuseProblem(
  config: WrittenRunConfig,
  found: Map<string, Judge>,
): string | null {
  // Only `targets` is read from the entry here — the rest of what a link
  // carries needs no checking against the judge — so the principal, which is
  // the whole configuration, satisfies this shape as readily as an entry.
  const named: {
    handle: string;
    spec: { targets?: JudgeTarget[] | null };
    label: string;
  }[] = [];
  if (config.judge) {
    named.push({ handle: config.judge, spec: config, label: "the judge" });
  }
  for (const [index, spec] of (config.judges ?? []).entries()) {
    if (spec.judge) {
      named.push({ handle: spec.judge, spec, label: `judge ${index + 1}` });
    }
  }

  for (const { handle, spec, label } of named) {
    const problem = namedJudgeProblem(
      found.get(handle),
      handle,
      spec,
      config.scenarios.length,
      config.turns,
      label,
    );
    if (problem) return problem;
  }
  return null;
}

/** What is wrong with ONE judge named by its handle, or null.
 *
 * Split out of `reuseProblem` above for `addJudge` (`runs.ts`), which names a
 * single judge on a run already launched and would otherwise have had to repeat
 * these four sentences. `judge` is what the handle resolved to, `undefined`
 * when nothing did. */
export function namedJudgeProblem(
  judge: Judge | undefined,
  handle: string,
  spec: { targets?: JudgeTarget[] | null },
  scenarioCount: number,
  turns: number,
  label: string,
): string | null {
  if (!judge) {
    return (
      `${label}: no judge answers to the handle "${handle}". ` +
      "The judges page lists the handles, or write the question out to make a new judge"
    );
  }
  if (judge.system_type !== "ordinary") {
    return (
      `${label}: "${handle}" is a built-in judge. Turn it on with ` +
      "check_eval_awareness or check_adversary_fidelity, which is also how it is read back"
    );
  }
  // The rule that already applies to a judge written out, applied to one that
  // arrives made: at a single turn the adversary never speaks, so a judge that
  // grades it would read a transcript holding nothing it is meant to grade.
  if (judge.grades !== "assistant" && turns <= 1) {
    return (
      `${label}: "${handle}" grades the adversary, which needs turns above 1 — ` +
      "at a single turn the adversary never speaks"
    );
  }
  // Targets belong to the link, so they are written on this run and checked
  // against the scale of the judge being reused, which the configuration does
  // not carry.
  return targetsProblem(
    spec.targets,
    scenarioCount,
    judge.rubric ?? undefined,
    `${label} ("${handle}")`,
  );
}

/** What a named judge writes into the configuration it is named from.
 *
 * Only the fields that describe a judge — the link's own, `model` and
 * `targets`, are the writer's and stay untouched. */
function describedBy(judge: Judge): {
  criterion: string;
  rubric: RubricLevel[];
  grades: JudgeGrades;
  sees_adversary_goals: boolean;
  sees_system_prompt: boolean;
  higher_is_better: boolean;
} {
  return {
    // A named judge is always ordinary, so both are filled — `judgeReuseProblem`
    // refuses a system handle before anything gets here. The fallbacks exist so
    // that this function cannot produce a configuration the engine would refuse
    // to parse, whatever reaches it.
    criterion: judge.criterion ?? "",
    rubric: judge.rubric ?? [],
    grades: judge.grades,
    sees_adversary_goals: judge.sees_adversary_goals,
    sees_system_prompt: judge.sees_system_prompt,
    higher_is_better: judge.higher_is_better,
  };
}

/** The configuration as it will be STORED: every named judge replaced by the
 *  description it names.
 *
 * A run keeps the photograph of what was asked, and that photograph has to be
 * complete. The engine parses it with pydantic (`EvalConfig` in
 * `eval_schemas.py`), which requires a criterion and a scale and knows nothing
 * of handles; every screen and every export reads those same fields. So the
 * handle lives exactly as long as the launch: written by a person or an agent,
 * settled here, and read back afterwards from the run's judges, where it
 * belongs.
 *
 * The judge rows themselves are NOT duplicated — that is the whole point. See
 * `judgesForLaunch`, which links the very rows named here. */
export function settleReusedJudges(
  config: WrittenRunConfig,
  reused: ReusedJudges,
): EvalRunConfig {
  const { judge: _handle, ...rest } = config;
  const settled = {
    ...rest,
    ...(reused.principal
      ? { ...describedBy(reused.principal), judge_label: reused.principal.label }
      : {}),
  } as EvalRunConfig;

  if (config.judges) {
    settled.judges = config.judges.map((spec, index) => {
      const named = reused.secondary[index];
      const { judge: _entryHandle, ...entry } = spec;
      return (
        named
          ? { ...entry, ...describedBy(named), label: named.label }
          : entry
      ) as JudgeSpec;
    });
  }
  return settled;
}
