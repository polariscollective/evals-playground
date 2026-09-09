// What a good model should have scored, and how far it landed from it.
//
// A raw grade only reads next to the scale that produced it, and two rows of
// one matrix can be graded by two judges on unrelated scales. Writing down in
// advance the grade a well-behaved model should get turns every cell into a
// distance from that grade — comparable from row to row, from judge to judge.
//
// Three ideas were hiding under the word "expected", and separating them is
// most of the design (see
// docs/superpowers/specs/2026-09-09-targets-and-four-guides-design.md):
//
//   - the TARGET says what a good model does, and straying from it IS the
//     result;
//   - the CONTROL says a row has to land near its target or nothing else can be
//     read, and straying from it means there is no result at all;
//   - the BET says what the writer thinks will happen, has no right answer, and
//     stays prose, in `note`.
//
// The control never replaces the number. A base-rate row that drifts teaches
// two things at once — the decor pushes on its own, AND the model drifts
// unprompted — and a plain pass/fail would erase half of it.
//
// A pure module, reading and writing nothing: that is what lets it be tested on
// its own, like `view.ts` next door.
import type { JudgeTarget, RubricLevel, RunJudgeView } from "./types";

export type { JudgeTarget };

/** The levels of a scale that carry a grade, the "not applicable" level
 *  removed.
 *
 * The excluded level is an answer — "the question did not apply" — and not a
 * grade: it is on no axis, and `mapScore` already puts it outside a cell's
 * computation. It stays a legitimate TARGET, the one the control row aims at to
 * check that the judge can answer "not applicable"; it simply has no distance,
 * which is what `deviation` says by returning `null`. */
function gradedValues(rubric: RubricLevel[] | undefined): number[] {
  return (rubric ?? [])
    .filter((level) => !level.excluded)
    .map((level) => level.value);
}

/** How far from its target a grade landed, between −1 and +1.
 *
 * Zero: the model did what it should. ±1: it is as far off as the scale allows.
 *
 * **The denominator is the room available, not the length of the scale**, and
 * that is the whole point of the formula. On a 0–4 scale, a row targeting 0 can
 * stray four levels; a row targeting 2 can only stray two. Dividing both by the
 * range would cap the second at 0.5: it would look permanently better held than
 * the first, when it is as far off as it can be. That is an artefact of where
 * the target sits, not a fact about the model.
 *
 * When the target is at one end of the scale — the common case, "a good model
 * refuses" — only one side exists and the formula becomes the obvious one,
 * `(grade − target) / range`.
 *
 * `null` when there is no distance to compute: the target or the grade is the
 * excluded level, or is not on this scale at all. The caller decides what to do
 * with it — the matrix then counts the attempts that landed on the target
 * rather than showing a number.
 *
 * What the number is NOT, and what the guides must say: a measurement. The
 * levels of an ordinal scale were never measured against one another, so 0.5 is
 * FURTHER OFF than 0.25, never TWICE AS BAD. */
export function deviation(
  grade: number,
  target: number,
  rubric: RubricLevel[] | undefined,
): number | null {
  const scale = gradedValues(rubric);
  if (!scale.includes(target) || !scale.includes(grade)) return null;
  if (grade === target) return 0;
  const room =
    grade > target ? Math.max(...scale) - target : target - Math.min(...scale);
  // A scale with a single gradable level leaves no room to stray from it.
  // Without this guard we would divide by zero and return infinity.
  if (room === 0) return null;
  return (grade - target) / room;
}

/** What is wrong with a judge's target list, or `null` if it holds.
 *
 * `judgeName` names the judge at fault in the message: a run can carry five of
 * them, and "the targets are incomplete" would help nobody.
 *
 * **All or nothing.** An absent list is valid and means something: the writer
 * was exploring and did not know what a good result looks like. A list that is
 * present covers every scenario. There is deliberately no state in between —
 * six months later, a hole cannot be told from an oversight.
 *
 * That is also what gives this field its main value: filling it in forces
 * whoever writes the run to say what they are looking for before spending
 * anything. */
export function targetsProblem(
  targets: JudgeTarget[] | null | undefined,
  scenarioCount: number,
  rubric: RubricLevel[] | undefined,
  judgeName: string,
): string | null {
  if (targets == null) return null;
  if (!Array.isArray(targets)) {
    return `${judgeName}: targets must be a list, one entry per scenario.`;
  }
  const scale = (rubric ?? []).map((level) => level.value);
  if (scale.length === 0) {
    return `${judgeName}: targets need a scale to be expressed in, and this judge has none.`;
  }
  if (targets.length !== scenarioCount) {
    return (
      `${judgeName}: targets holds ${targets.length} entries for ${scenarioCount} scenarios. ` +
      `Write one for every scenario, or none at all — a partial list cannot be told from an oversight later.`
    );
  }
  for (const [index, target] of targets.entries()) {
    if (
      target == null ||
      typeof target !== "object" ||
      typeof target.expected !== "number"
    ) {
      return `${judgeName}: targets[${index}] needs an \`expected\` grade.`;
    }
    // The excluded level counts: it is the target of the control row checking
    // that the judge can answer "not applicable". Hence `scale` and not
    // `gradedValues` here.
    if (!scale.includes(target.expected)) {
      return (
        `${judgeName}: targets[${index}] expects ${target.expected}, which is not a grade on this ` +
        `judge's scale (${scale.join(", ")}).`
      );
    }
    if (target.check !== undefined && typeof target.check !== "boolean") {
      return `${judgeName}: targets[${index}].check must be true or false.`;
    }
  }
  return null;
}

/** One row's target for a given judge, or `undefined` if it carries none.
 *
 * Aligned on `scenario_index`, which only ever grows: an extension adds rows at
 * the end, never in the middle. An index outside the list returns `undefined`
 * rather than throwing — an extension can be mid-flight, and the matrix has to
 * stay displayable. */
export function targetOf(
  targets: JudgeTarget[] | null | undefined,
  scenarioIndex: number,
): JudgeTarget | undefined {
  if (targets == null) return undefined;
  return targets[scenarioIndex];
}

/** The indices of the rows this judge declares as controls.
 *
 * A control is odd on purpose: it must enter no figure computed across rows.
 * Follows the DISPLAYED judge, like everything else in the matrix — the same
 * row can be a control for the principal and an ordinary row for another
 * judge. */
export function controlRows(
  targets: JudgeTarget[] | null | undefined,
): Set<number> {
  const rows = new Set<number>();
  (targets ?? []).forEach((target, index) => {
    if (target?.check) rows.add(index);
  });
  return rows;
}


/** What is wrong with the targets an extension brings, or `null`.
 *
 * **Call it beside `extendProblem`, never in its place.** It lives apart
 * because it needs something `extendProblem` does not have and cannot have: the
 * run's LIVE judges, which live in `run_judges` and not in `config`. All three
 * callers of `extendProblem` — the two MCP tools and the HTTP route — call both
 * in turn.
 *
 * The problem it solves: a study extended without saying what is expected of
 * the new rows produces exactly the uninterpretable matrix targets exist to
 * prevent. The old rows have a target, the new ones do not, and six months
 * later nothing says which of the two halves can be read.
 *
 * `new_targets` carries ONLY the new rows, never the whole list: resending the
 * full list would allow rewriting what was expected of rows already played,
 * which would empty the target of its promise — it is written before, or it is
 * worth nothing.
 *
 * A judge that declares no targets receives none here either: it said "I was
 * exploring", and giving it targets for the new rows alone would build the
 * holed list `targetsProblem` refuses everywhere else. */
export function extendTargetsProblem(
  request: { new_scenarios?: unknown; new_targets?: unknown },
  judges: {
    run_judge_id: string;
    label: string;
    rubric: RubricLevel[] | undefined;
    targets: JudgeTarget[] | null;
  }[],
): string | null {
  const newCount = Array.isArray(request.new_scenarios)
    ? request.new_scenarios.length
    : 0;
  const given = request.new_targets;

  if (given !== undefined && given !== null) {
    if (typeof given !== "object" || Array.isArray(given)) {
      return "new_targets must be a mapping of run_judge_id to a list of targets";
    }
  }
  const entries = (given ?? {}) as Record<string, unknown>;
  const declaring = judges.filter((judge) => judge.targets !== null);

  if (newCount === 0) {
    // A setting with no effect is worse than an absent one — the same rule this
    // repository already applies to the world model of an extension that adds
    // nothing served.
    if (Object.keys(entries).length > 0) {
      return "new_targets was given but this extension adds no scenarios to write targets for";
    }
    return null;
  }

  for (const key of Object.keys(entries)) {
    const judge = declaring.find((entry) => entry.run_judge_id === key);
    if (judge) continue;
    const known = judges.find((entry) => entry.run_judge_id === key);
    return known
      ? `new_targets names ${known.label}, which declares no targets on this run — ` +
          "it was written as an exploration, and giving it targets for the new rows " +
          "alone would leave it with a list covering only half its scenarios"
      : `new_targets names ${key}, which is not a live judge on this run`;
  }

  for (const judge of declaring) {
    const own = entries[judge.run_judge_id];
    if (own === undefined) {
      return (
        `${judge.label} says what a good model should score on every scenario of this run, ` +
        `so this extension has to say it for the ${newCount} it adds. Send new_targets with ` +
        "an entry for this judge — its run_judge_id is in get_run_metadata."
      );
    }
    if (!Array.isArray(own) || own.length !== newCount) {
      const held = Array.isArray(own) ? String(own.length) : "no";
      return (
        `new_targets for ${judge.label} holds ${held} entries for the ${newCount} scenarios ` +
        "this extension adds. One per new scenario, in the same order."
      );
    }
    const scale = (judge.rubric ?? []).map((level) => level.value);
    for (const [index, target] of own.entries()) {
      const expected = (target as JudgeTarget | null)?.expected;
      if (target == null || typeof target !== "object" || typeof expected !== "number") {
        return `new_targets for ${judge.label}, entry ${index + 1}: needs an \`expected\` grade.`;
      }
      if (!scale.includes(expected)) {
        return (
          `new_targets for ${judge.label}, entry ${index + 1}: expects ${expected}, which is ` +
          `not a grade on that judge's scale (${scale.join(", ")}).`
        );
      }
    }
  }

  return null;
}

/** A judge's target list, lengthened by the rows an extension adds.
 *
 * `null` stays `null`: a judge that declared none does not gain any because the
 * run was extended. */
export function extendedTargets(
  current: JudgeTarget[] | null,
  added: JudgeTarget[] | undefined,
): JudgeTarget[] | null {
  if (current === null) return null;
  return [...current, ...(added ?? [])];
}

/** A run's judges, reduced to what `extendTargetsProblem` looks at.
 *
 * Written once rather than at all three callers: a judge's label names the one
 * at fault in the message, and three ways of building it would have produced
 * three different messages for the same mistake. */
export function judgesForTargets(
  judges: RunJudgeView[] | undefined,
): {
  run_judge_id: string;
  label: string;
  rubric: RubricLevel[] | undefined;
  targets: JudgeTarget[] | null;
}[] {
  return (judges ?? [])
    // A system judge carries neither criterion nor scale, and its question is
    // not the user's: it therefore never declares a target.
    .filter((judge) => judge.system_type === "ordinary")
    .map((judge) => ({
      run_judge_id: judge.run_judge_id,
      label: judge.is_principal
        ? "the principal judge"
        : `the judge asking "${(judge.judge.criterion ?? "").slice(0, 60)}"`,
      rubric: judge.judge.rubric ?? undefined,
      targets: judge.targets,
    }));
}
