// The validation of what a client sends, before it enters the database or
// leaves in a job.
//
// What pydantic used to do on the Python side. Nothing arriving from the
// browser is believed: a scale with a single level, an empty scenario or a
// multi-turn run with no adversary would produce a run that measures nothing,
// and the job would have no way of noticing.
import { knownModelIds } from "./catalog.ts";
import { targetsProblem } from "./targets.ts";
import { servesTools } from "./tools.ts";
import type {
  Draft,
  EvalRunConfig,
  ExtendDraft,
  ExtendRequest,
  JudgeSpec,
  RubricLevel,
  SeededTurn,
  ToolSpec,
} from "./types";

const MIN_TURNS = 1;
// Exported: the extension panel used to duplicate it for want of anything
// better (task 6), and the MCP tool needs it to bound `turns` without copying it
// in turn.
export const MAX_TURNS = 100;

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The shape of a judge's handle, copied from `judges_slug_shape_check` in the
 *  database. Checked here so that a typo comes back as a sentence about a
 *  handle rather than as a lookup that finds nothing. */
const JUDGE_HANDLE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The fields that describe a judge, and that therefore may not be written
 *  beside a handle: naming a judge takes all of them from it.
 *
 * `model` and `targets` are absent from this list on purpose. They belong to the
 * link, not to the judge, and stay writable on every run — see `RunJudge`.
 *
 * The name is the one field whose key differs between the two shapes, and
 * mixing them up costs a false refusal: at the top level `label` is the RUN's
 * title and has nothing to do with any judge, the principal's name being
 * `judge_label`. Hence the parameter rather than one list covering both. */
function describesAJudge(nameField: "label" | "judge_label"): string[] {
  return [
    "criterion",
    "rubric",
    nameField,
    "grades",
    "sees_adversary_goals",
    "sees_system_prompt",
    "higher_is_better",
  ];
}

/** What is wrong with a judge named by its handle, or null if the naming holds.
 *
 * Shared by the principal, at the top level of a configuration, and by every
 * entry of `judges`: the two shapes name a judge the same way, and the message
 * only differs by what it calls the offender.
 *
 * Says nothing about whether the handle exists. That question needs the
 * database and is answered on the launch path — see `reusedJudges`
 * (`lib/runs.ts`), which reads the judges and hands them to `reuseProblem`
 * (`lib/launch-judges.ts`). */
export function judgeHandleProblem(
  written: Record<string, unknown>,
  label: string,
  nameField: "label" | "judge_label" = "label",
): string | null {
  const handle = written.judge;
  if (handle === undefined || handle === null) return null;
  if (!isFilled(handle)) {
    return `${label}: judge must be the handle of an existing judge, as text`;
  }
  if (!JUDGE_HANDLE.test(handle)) {
    return (
      `${label}: "${handle}" is not the shape of a handle — lowercase letters, ` +
      "digits and single hyphens, as shown on the judges page"
    );
  }
  const described = describesAJudge(nameField).filter(
    (field) => written[field] !== undefined && written[field] !== null,
  );
  if (described.length > 0) {
    return (
      `${label} names a judge and describes one: drop ${described.join(", ")}, ` +
      "or drop judge and write the question out. A named judge brings its own " +
      "question, scale and visibility; only model and targets stay yours"
    );
  }
  return null;
}

/** Every handle a configuration names, principal first, in the order they are
 *  written. Exported for `judgeReuseProblem`, which reads them from the
 *  database in one go. */
export function judgeHandlesIn(config: {
  judge?: unknown;
  judges?: unknown;
}): string[] {
  const handles: string[] = [];
  if (isFilled(config.judge)) handles.push(config.judge);
  if (Array.isArray(config.judges)) {
    for (const entry of config.judges) {
      const handle = (entry as { judge?: unknown } | null)?.judge;
      if (isFilled(handle)) handles.push(handle);
    }
  }
  return handles;
}

/** What is wrong with a model identifier, or null.
 *
 * Checked here for the reason that has the tool names checked just below:
 * otherwise the error falls at the first *billed* call, in the unreadable form
 * the provider returns. An identifier outside the catalogue is also counted as
 * zero tokens by the estimate — so the announced quote would be too low for a
 * run that has no chance of getting anywhere.
 *
 * The catalogue is the only list there is: `/format.txt` publishes it saying "Use
 * these identifiers exactly. Anything else fails at the first call." This
 * refusal only enforces what is already promised. */
function modelProblem(id: unknown, where: string): string | null {
  if (!isFilled(id)) return null;
  if (knownModelIds().has(id)) return null;
  return (
    `${where}: "${id}" is not a model this tool can run. ` +
    "Use one of the identifiers listed in /prompt, exactly as written."
  );
}

/** What is wrong with a temperature range, or null.
 *
 * One single copy for the launch and for the extension: both used to duplicate
 * it, with the same fault on both sides — three distinct violations returned
 * under the one message "upper bound is below the lower bound", which sent
 * people to fix `min` when it was `max` that was off the scale. */
function temperatureProblem(temperature: unknown): string | null {
  if (!temperature) return null;
  if (typeof temperature !== "object") return "temperature must be a min, or a min and a max";
  const { min, max } = temperature as { min?: unknown; max?: unknown };

  // `min` carries the temperature when there is no range — see the `/format.txt`
  // template, "omit max to use one fixed temperature". Requiring it rather than
  // giving it a default value avoids the trap of a hidden default: a file that
  // wrote only `max` received "upper bound is below the lower bound" about a
  // lower bound it had never written.
  if (typeof min !== "number" || !Number.isFinite(min)) {
    return "temperature needs a min: the fixed temperature, or the bottom of the range";
  }
  if (min < 0 || min > 2) return "temperature must be between 0 and 2";

  if (max === undefined || max === null) return null;
  if (typeof max !== "number" || !Number.isFinite(max)) {
    return "the temperature upper bound must be a number";
  }
  if (max < 0 || max > 2) return "temperature must be between 0 and 2";
  if (max < min) return "the temperature upper bound is below the lower bound";
  return null;
}

/** What is wrong with a scale, or null if it holds. */
export function rubricProblem(rubric: unknown): string | null {
  if (!Array.isArray(rubric) || rubric.length < 2) {
    // With a single level there is no choice to make, hence nothing to measure.
    return "rubric must have at least two grades";
  }
  const values: number[] = [];
  for (const level of rubric as RubricLevel[]) {
    if (typeof level?.value !== "number" || !Number.isFinite(level.value)) {
      return "every grade needs a numeric value";
    }
    if (!isFilled(level?.meaning)) {
        // A grade without its meaning cannot be read back, and the judge would
        // not know when to choose it.
      return "every grade needs a description";
    }
    values.push(level.value);
  }
  if (new Set(values).size !== values.length) {
      // The judge chooses a value, and it is by that value that we find the
      // meaning that was given to it.
    return "two grades cannot share the same value";
  }
  // A "not applicable" measures nothing: a scale that held only it and one real
  // level would leave no choice to make.
  const counted = (rubric as RubricLevel[]).filter((level) => !level.excluded);
  if (counted.length < 2) {
    return "at least two grades must count towards the average";
  }
  return null;
}

/** Whose turns a judge grades, and whether the run can answer for it.
 *
 * Two rules, and they are the same on both sides of the wire — see
 * `_judge_grades_coherent` (`backend/playground/eval_schemas.py`).
 *
 * **A judge grading the adversary must see its objective.** Otherwise it is
 * asked whether the adversary did what it was told, without being told what
 * that was. Refused rather than quietly turned on: somebody who wrote
 * `sees_adversary_goals: false` next to `grades: adversary` meant something,
 * and it cannot be had.
 *
 * **Neither has any meaning at one turn.** The adversary never speaks there, so
 * a judge reading its turns finds none and answers anyway, and an objective
 * shown to a judge is an objective nobody acted on. */
export function judgeGradesProblem(
  judge: { grades?: unknown; sees_adversary_goals?: unknown },
  turns: number,
  label: string,
): string | null {
  const { grades, sees_adversary_goals: goals } = judge;
  if (goals !== undefined && typeof goals !== "boolean") {
    return `${label}: sees_adversary_goals must be true or false`;
  }
  if (grades === undefined || grades === null) {
    return goals === true && turns <= 1
      ? `${label}: sees_adversary_goals needs turns above 1, since at a single turn the adversary never speaks`
      : null;
  }
  if (grades !== "assistant" && grades !== "adversary" && grades !== "exchange") {
    return `${label}: grades must be assistant, adversary or exchange`;
  }
  if (grades === "adversary" && goals === false) {
    return `${label}: a judge grading the adversary has to see its objective, so sees_adversary_goals cannot be false`;
  }
  if ((grades !== "assistant" || goals === true) && turns <= 1) {
    return `${label}: grading the adversary needs turns above 1, since at a single turn the adversary never speaks`;
  }
  return null;
}

/** What is wrong with ONE `JudgeSpec`, or null if it holds — whether it is an
 *  entry of `config.judges` at launch (see `judgesProblem`, just below, which
 *  calls it for each) or the body posted to `.../judges` to add a judge
 *  afterwards (`app/api/runs/[runId]/judges/route.ts`).
 *
 * `label` names what is wrong in the returned message — "judge 2", or "the new
 * judge" on the adding route's side, which has only one entry to name.
 *
 * `scenarioCount` is known only to callers holding the run: the whole
 * configuration (`configProblem`), or the adding route, which reads it from the
 * run it targets. Absent, a target list is checked on its shape and its values,
 * never on its length — a judge examined outside any run cannot know how many
 * scenarios it should cover. */
export function judgeSpecProblem(
  spec: unknown,
  label: string,
  scenarioCount?: number,
  /** The run's depth, for the rules that depend on there being an adversary at
   *  all — see `judgeGradesProblem`. Optional like `scenarioCount` above: a
   *  caller that does not hold it gets the shape checks and not that one. */
  turns?: number,
): string | null {
  if (!spec || typeof spec !== "object") return `${label} is not a mapping`;
  const judge = spec as JudgeSpec;
  const named = judgeHandleProblem(spec as Record<string, unknown>, label);
  if (named) return named;
  // A named judge brings its question, its scale, whose turns it grades and
  // what it is shown: none of that is checked here, because none of it is
  // written here. What it cannot bring is the run it is about to grade, so the
  // rules that cross the two — a scale the targets must be expressed in, an
  // adversary to grade at a single turn — are checked once the judge is
  // resolved, in `judgeReuseProblem` (`lib/runs.ts`).
  const reuses = isFilled((spec as { judge?: unknown }).judge);
  if (!reuses) {
    if (!isFilled(judge.criterion)) return `${label} needs something to look at`;
    const rubric = rubricProblem(judge.rubric);
    if (rubric) return `${label}: ${rubric}`;
    if (judge.sees_system_prompt !== undefined && typeof judge.sees_system_prompt !== "boolean") {
      return `${label}: sees_system_prompt must be true or false`;
    }
    if (
      judge.higher_is_better !== undefined &&
      typeof judge.higher_is_better !== "boolean"
    ) {
      return `${label}: higher_is_better must be true or false`;
    }
    const whose = judgeGradesProblem(judge, turns ?? 2, label);
    if (whose) return whose;
    const targets = targetsProblem(
      judge.targets,
      scenarioCount ?? judge.targets?.length ?? 0,
      judge.rubric,
      label,
    );
    if (targets) return targets;
  }
  // Absent inherits the run's model — see `JudgeSpec.model`. Present, it must
  // be a non-empty text: a different type is not guessed, and letting it through
  // would run this judge under the default model without anyone having asked
  // for it, exactly the trap already met on `check_eval_awareness`.
  if (judge.model !== undefined && judge.model !== null && !isFilled(judge.model)) {
    return `${label}: model must be a non-empty string`;
  }
  const model = modelProblem(judge.model, label);
  if (model) return model;
  return null;
}

/** What is wrong with a run's secondary judges, or null.
 *
 * `judges` is optional: absent or empty, this is the old shape — a single judge,
 * the principal, described by `criterion` and `rubric` at the top level of the
 * configuration. Each entry here adds one more, always ordinary — see the
 * docstring of `JudgeSpec` in `types.ts`: this shape carries neither a system
 * type nor a mark of principal, so nothing here can stand in for the principal
 * or pass itself off as an awareness judge. The two shapes never contradict each
 * other: the top level always describes the principal, `judges` only ever adds
 * secondary judges. */
export function judgesProblem(
  judges: unknown,
  scenarioCount?: number,
  /** The run's depth, passed straight down — see `judgeSpecProblem`. */
  turns?: number,
): string | null {
  if (judges === undefined || judges === null) return null;
  if (!Array.isArray(judges)) return "judges must be a list";

  for (const [index, entry] of judges.entries()) {
    const problem = judgeSpecProblem(
      entry,
      `judge ${index + 1}`,
      scenarioCount,
      turns,
    );
    if (problem) return problem;
  }
  return null;
}

/** The providers accept no other form of name. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const TOOL_PARAM_TYPES = ["string", "number", "integer", "boolean"];

/** What is wrong with a run's tools, or null.
 *
 * The name is checked here because otherwise the error falls at the first billed
 * call and in an unreadable form: the providers refuse the whole request without
 * saying which tool is at fault. */
export function toolsProblem(tools: unknown): string | null {
  if (tools === undefined || tools === null) return null;
  if (!Array.isArray(tools)) return "tools must be a list";

  const seen = new Set<string>();
  for (const tool of tools as ToolSpec[]) {
    if (!isFilled(tool?.name)) return "every tool needs a name";
    if (!TOOL_NAME.test(tool.name)) {
      return `tool "${tool.name}": a name may only use letters, digits, - and _, and at most 64 of them`;
    }
    if (seen.has(tool.name)) return `two tools are both named "${tool.name}"`;
    seen.add(tool.name);

      // A tool is fixed or served from the world, never both. Neither one nor
      // the other stays lawful and describes a fixed tool with an empty result:
      // `result` has defaulted to `""` from the start, and breaking the reading
      // back of the runs already in the database for a rule that adds nothing
      // would be dearly bought.
    if (isFilled(tool.result) && isFilled(tool.retrieval_rules)) {
      return (
        `tool "${tool.name}" carries both result and retrieval_rules: ` +
        "a tool is fixed or served from the world, never both"
      );
    }
    if (!isFilled(tool.description)) {
        // A tool with no description is a tool the model will never call, or
        // will call at random: in both cases the cell does not measure what one
        // thinks.
      return `tool "${tool.name}" needs a description — it is what the model reads to decide`;
    }

    const params = tool.parameters ?? [];
    if (!Array.isArray(params)) return `tool "${tool.name}": parameters must be a list`;
    const names = new Set<string>();
    for (const param of params) {
      if (!isFilled(param?.name)) return `tool "${tool.name}": a parameter has no name`;
      if (names.has(param.name)) {
        return `tool "${tool.name}": two parameters are both named "${param.name}"`;
      }
      names.add(param.name);
      if (!TOOL_PARAM_TYPES.includes(param.type)) {
        return `tool "${tool.name}", parameter "${param.name}": type must be one of ${TOOL_PARAM_TYPES.join(", ")}`;
      }
    }
  }
  return null;
}

/** What is wrong with the tools a scenario asks for, or null. */
export function scenarioToolsProblem(
  asked: unknown,
  available: ToolSpec[],
  where: string,
): string | null {
  if (asked === undefined || asked === null) return null;
  if (!Array.isArray(asked)) return `${where}: tools must be a list of names`;
  const known = new Set(available.map((tool) => tool.name));
  for (const name of asked) {
    if (!known.has(name)) {
      return `${where}: no tool named "${name}" is defined for this run`;
    }
  }
  return null;
}

/** What is wrong with a seeded history, or null.
 *
 * It opens on the user and closes on the assistant, because the opening message
 * is the user turn that follows: two user turns in a row, some providers refuse
 * and the others each interpret their own way. Saying so here rather than at the
 * first billed call.
 *
 * The history consumes no turn: `turns` counts the answers really asked of the
 * evaluated model, starting from the opening message. */
export function historyProblem(history: unknown, where: string): string | null {
  if (history === undefined || history === null) return null;
  if (!Array.isArray(history)) return `${where}: history must be a list`;
  if (history.length === 0) return null;

  for (const [index, turn] of history.entries()) {
    const role = (turn as SeededTurn)?.role;
    const expected = index % 2 === 0 ? "user" : "assistant";
    if (role !== expected) {
      return `${where}: history must alternate user/assistant — turn ${
        index + 1
      } is ${role ?? "empty"} where ${expected} was expected`;
    }
    if (!isFilled((turn as SeededTurn)?.content)) {
      return `${where}: history turn ${index + 1} is empty`;
    }
  }
  if ((history.at(-1) as SeededTurn).role !== "assistant") {
    return `${where}: history must end on an assistant turn — the opening message is the user turn that follows it`;
  }
  return null;
}

/** What is wrong with the served-tool / `models.world` equivalence, or null if
 *  it holds.
 *
 * Serving with no model would answer nothing; naming a model with nothing to
 * serve is a setting with no effect, and a setting with no effect is worse than
 * an absent one — it is read back later wondering whether it counted. Mirror of
 * the Python refusal in `_world_and_serving_equivalent`, see
 * `backend/playground/eval_schemas.py`.
 *
 * Extracted from `configProblem` (CRITICAL 1): `retry` and `catchup` must refuse
 * exactly what the job would refuse on the same footing — that equivalence, and
 * nothing more — rather than the whole launch validation, far stricter
 * (`average_output_tokens`, notably, which the job accepts absent on a run
 * recorded before that field). `configProblem` stays the one caller that must
 * check everything; `retry` and `catchup` need only this one, and now call it
 * directly — one definition, three callers. */
export function worldEquivalenceProblem(
  config: Pick<EvalRunConfig, "tools" | "models">,
): string | null {
  const serves = servesTools(config.tools ?? []);
  const world = isFilled(config.models?.world);
  if (serves && !world) {
    return (
      "models.world: this run serves at least one tool, so it needs a model to " +
      "answer those calls. Pick one from the models listed in /prompt."
    );
  }
  if (!serves && world) {
    return (
      "models.world: no tool in this run has retrieval_rules, so nothing is " +
      "served and this model would never be called. Remove it, or give a tool " +
      "reading rules."
    );
  }
  return null;
}

/** What is wrong with a run's configuration, or null if it holds. */
export function configProblem(config: unknown): string | null {
  if (!config || typeof config !== "object") return "config must be an object";
  const c = config as EvalRunConfig;

  if (!Array.isArray(c.scenarios) || c.scenarios.length === 0) {
    return "at least one scenario is required";
  }
  for (const scenario of c.scenarios) {
    if (
      !isFilled(scenario?.title) ||
      !isFilled(scenario?.system_prompt) ||
      !isFilled(scenario?.opening_message)
    ) {
      return "every scenario needs a title, a system prompt and an opening message";
    }
    const history = historyProblem(scenario.history, `scenario "${scenario.title}"`);
    if (history) return history;
  }

  const tools = toolsProblem(c.tools);
  if (tools) return tools;
  const cap = c.max_tool_calls_per_turn;
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 1 || cap > 20)) {
    return "consecutive tool calls per turn must be a whole number between 1 and 20";
  }

  // A boolean or nothing, never anything else. A string "false" written in
  // quotes by mistake is not equal to the boolean `false`: letting it through
  // here would have it read further on as the switch left on, without anyone
  // knowing — a judge one has explicitly asked to turn off would keep running
  // and being billed.
  const awareness = c.check_eval_awareness;
  if (awareness !== undefined && typeof awareness !== "boolean") {
    return "check_eval_awareness must be true or false";
  }

  const whose = judgeGradesProblem(
    { grades: c.grades, sees_adversary_goals: c.sees_adversary_goals },
    c.turns,
    "the judge",
  );
  if (whose) return whose;

  const fidelity = c.check_adversary_fidelity;
  if (fidelity !== undefined && typeof fidelity !== "boolean") {
    return "check_adversary_fidelity must be true or false";
  }
  // A judge grading the adversary needs there to be one. At a single turn the
  // adversary never speaks, so this judge would read a conversation holding
  // nothing it is meant to grade and answer anyway. Mirrors
  // `_adversary_fidelity_needs_an_adversary` in `eval_schemas.py`.
  if (fidelity === true && c.turns <= 1) {
    return (
      "check_adversary_fidelity needs an adversary, so it needs turns above 1: " +
      "at a single turn the adversary never speaks"
    );
  }

  for (const scenario of c.scenarios) {
    const asked = scenarioToolsProblem(
      scenario.tools,
      c.tools ?? [],
      `scenario "${scenario.title}"`,
    );
    if (asked) return asked;
  }

  // The principal may name an existing judge rather than describe one, exactly
  // as an entry of `judges` may — see `WrittenRunConfig.judge`. Named, it brings
  // its own question and scale, and the block below has nothing left to check.
  const namedPrincipal = judgeHandleProblem(
    config as Record<string, unknown>,
    "the judge",
    "judge_label",
  );
  if (namedPrincipal) return namedPrincipal;
  const reusesPrincipal = isFilled((config as { judge?: unknown }).judge);

  if (!reusesPrincipal) {
    if (!isFilled(c.criterion)) return "the judge needs something to look at";

    const rubric = rubricProblem(c.rubric);
    if (rubric) return rubric;

    if (c.sees_system_prompt !== undefined && typeof c.sees_system_prompt !== "boolean") {
      return "sees_system_prompt must be true or false";
    }
    if (c.higher_is_better !== undefined && typeof c.higher_is_better !== "boolean") {
      return "higher_is_better must be true or false";
    }
    // The principal describes itself at the top level, like `criterion` and
    // `rubric` — hence this check here rather than in `judgesProblem`, which only
    // ever sees the secondaries.
    const principalTargets = targetsProblem(
      c.targets,
      c.scenarios.length,
      c.rubric,
      "the principal judge",
    );
    if (principalTargets) return principalTargets;
  }

  const judges = judgesProblem(c.judges, c.scenarios.length, c.turns);
  if (judges) return judges;

  // One link per judge per run. Naming the same judge twice would ask for two
  // columns holding the same verdicts, and the second insert would fail on the
  // link's own uniqueness anyway: better said here, where the message can name
  // the handle.
  const handles = judgeHandlesIn(config as { judge?: unknown; judges?: unknown });
  const twice = handles.find((handle, index) => handles.indexOf(handle) !== index);
  if (twice) {
    return `the judge "${twice}" is named twice: one run links a judge once`;
  }

  if (!Number.isInteger(c.turns) || c.turns < MIN_TURNS || c.turns > MAX_TURNS) {
    return `turns must be between ${MIN_TURNS} and ${MAX_TURNS}`;
  }
  if (!Number.isInteger(c.repetitions) || c.repetitions < 1) {
    return "repetitions must be at least 1";
  }

  const output = c.average_output_tokens;
  if (output === undefined || output === null) {
    return (
      "average_output_tokens is required: roughly how many output tokens one " +
      "model answer costs, reasoning included, not just the visible reply"
    );
  }
  if (!Number.isInteger(output) || output < 1 || output > 100_000) {
    return "average_output_tokens must be a whole number between 1 and 100000";
  }

  const targets = c.models?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    return "at least one evaluated model is required";
  }
  if (targets.some((target) => !isFilled(target))) {
    return "an evaluated model identifier is empty";
  }
  if (new Set(targets).size !== targets.length) {
    return "the same evaluated model appears more than once";
  }
  if (!isFilled(c.models?.judge)) return "a judge model is required";

  // At a single turn the adversary is never called: not requiring it avoids
  // making someone fill in a useless field for a simple round trip.
  if (c.turns > 1) {
    if (!isFilled(c.models?.adversary)) {
      return "an adversary model is required once turns exceeds 1";
    }
    if (!isFilled(c.adversary_prompt)) {
      return "an adversary prompt is required once turns exceeds 1";
    }
  }

  // After the structural rules, and not before: a missing adversary or a
  // duplicated model are faults of form, better announced before going off to
  // read an identifier. Otherwise a document missing its adversary would find
  // itself reproached for the name of its evaluated model.
  for (const target of targets) {
    const problem = modelProblem(target, "evaluated model");
    if (problem) return problem;
  }
  const judgeModel = modelProblem(c.models?.judge, "judge model");
  if (judgeModel) return judgeModel;
  const adversaryModel = modelProblem(c.models?.adversary, "adversary model");
  if (adversaryModel) return adversaryModel;
  const worldModel = modelProblem(c.models?.world, "world model");
  if (worldModel) return worldModel;

  // The equivalence, in both directions — see `worldEquivalenceProblem`, which
  // now carries that rule alone.
  const worldEquivalence = worldEquivalenceProblem(c);
  if (worldEquivalence) return worldEquivalence;

  const temperature = temperatureProblem(c.temperature);
  if (temperature) return temperature;

  return null;
}

/** What is wrong with a request to add to a run, or null.
 *
 * `scenarioCount` is the size of the current matrix: an index beyond it would
 * designate a scenario the job could not read, since it is by that index that it
 * finds the opening message.
 *
 * `runWorldModel` is the run's `models.world` as it stands before this
 * extension — `null` when the run has none yet, whether because it serves
 * nothing or because it was launched before that model could be chosen. Added
 * last so as to move no existing caller. */
export function extendProblem(
  request: unknown,
  scenarioCount: number,
  runTools: ToolSpec[] = [],
  currentTurns = 1,
  adversary: string | null = null,
  rubricValues: number[] = [],
  runWorldModel: string | null = null,
): string | null {
  if (!request || typeof request !== "object") return "body must be an object";
  const r = request as ExtendRequest;

    // The added tools first: the scenarios that follow have the right to name
    // them, since they will exist when the cells run.
  const added = r.new_tools ?? [];
  const tools = toolsProblem(added);
  if (tools) return tools;
  for (const tool of added) {
    if (runTools.some((existing) => existing.name === tool.name)) {
        // Adding a tool has no effect on the past; redefining one does. The
        // cells already played would read back as having had this one, when they
        // had another under that name.
      return `the run already defines a tool named "${tool.name}"`;
    }
  }
  const available = [...runTools, ...added];

  // Three cases, and the third is the only surprising one: a run that already
  // serves imposes its model. Two servers within one run would make its cells
  // incomparable, and that is the one thing a matrix cannot survive. Placed
  // before the rest — scenarios, models, repetitions — so that a request merely
  // adding a served tool without naming a world is not first reproached for a
  // field it has no business carrying. The union of the already-there and the
  // added, not only the added: a run launched before this project already serves
  // tools with no `models.world` (`runWorldModel` is then `null`), and that is
  // the case that must require a model — not an extension that adds nothing
  // served but touches a run that does serve.
  const servesOnceApplied = servesTools(available);
  const named = isFilled(r.world);
  const worldModel = modelProblem(r.world, "world");
  if (worldModel) return worldModel;
  if (runWorldModel) {
    if (named && r.world !== runWorldModel) {
      return (
        `world: this run already serves its tools with "${runWorldModel}". An ` +
        "extension cannot change it — two servers within one run would make its " +
        "cells incomparable, which is the one thing a matrix cannot survive."
      );
    }
  } else if (servesOnceApplied) {
    if (!named) {
      return (
        "world: this run serves at least one tool but names no model to answer " +
        "its calls, so this extension needs to name one — it becomes the run's."
      );
    }
  } else if (named) {
    return (
      "world: this extension adds no served tool and the run serves none, so " +
      "this model would never be called."
    );
  }

  const indices = r.scenario_indices;
  if (!Array.isArray(indices)) return "scenario_indices must be a list";
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= scenarioCount) {
      return `scenario ${index} is not part of this run`;
    }
  }

  const fresh = r.new_scenarios;
  if (!Array.isArray(fresh)) return "new_scenarios must be a list";
  for (const scenario of fresh) {
    if (
      !isFilled(scenario?.title) ||
      !isFilled(scenario?.system_prompt) ||
      !isFilled(scenario?.opening_message)
    ) {
      return "every scenario needs a title, a system prompt and an opening message";
    }
    const history = historyProblem(scenario.history, `scenario "${scenario.title}"`);
    if (history) return history;
    const asked = scenarioToolsProblem(
      scenario.tools,
      available,
      `scenario "${scenario.title}"`,
    );
    if (asked) return asked;
  }

  // A model and repetitions designate nothing for a request that only deepens:
  // no cell is added, and `cellsForExtension` does not even read them in that
  // case. Requiring them only if the request really adds a scenario, existing or
  // fresh.
  if (indices.length > 0 || fresh.length > 0) {
    if (!Array.isArray(r.targets) || r.targets.length === 0) {
      return "at least one model is required";
    }
    if (r.targets.some((target) => !isFilled(target))) {
      return "a model identifier is empty";
    }
    if (new Set(r.targets).size !== r.targets.length) {
      return "the same model appears more than once";
    }
    for (const target of r.targets) {
      const problem = modelProblem(target, "model");
      if (problem) return problem;
    }

    if (!Number.isInteger(r.repetitions) || r.repetitions < 1) {
      return "repetitions must be at least 1";
    }
  }

  const depth = r.turns ?? currentTurns;
  if (!Number.isInteger(depth) || depth < MIN_TURNS || depth > MAX_TURNS) {
    return `turns must be between ${MIN_TURNS} and ${MAX_TURNS}`;
  }
  if (depth < currentTurns) {
      // A conversation already played is not cut short.
    return `turns cannot go below the ${currentTurns} turns already played`;
  }
  if (depth > 1 && !isFilled(adversary)) {
      // The engine refuses to play out more than one turn with nobody to push.
    return "an adversary model is required once turns exceeds 1";
  }

  const toDeepen = r.deepen;
  if (toDeepen !== undefined && toDeepen !== "all") {
    if (!Array.isArray(toDeepen) || toDeepen.length === 0) {
      return "deepen must be \"all\" or a non-empty list of scores";
    }
    for (const score of toDeepen) {
      if (typeof score !== "number" || !Number.isFinite(score)) {
        return "a score to deepen must be a number";
      }
      if (!rubricValues.includes(score)) {
          // A grade absent from the scale would match no attempt: the request
          // would silently deepen zero attempts, which is worse than a refusal.
        return `score ${score} is not part of this run's rubric`;
      }
    }
  }
  if (toDeepen !== undefined && (r.turns ?? currentTurns) <= currentTurns) {
      // With no new depth there is nothing to continue: the request would be
      // silently without effect, which is worse than a refusal.
    return "deepening needs more turns to deepen to";
  }

  const freshJudges = r.new_judges ?? [];
  if (!Array.isArray(freshJudges)) return "new_judges must be a list";
  for (const [index, spec] of freshJudges.entries()) {
    // The run's count, not that of the list sent: a judge placed on a
    // twelve-row run has to say what it expects of the twelve. Without this
    // third argument, a list of three went through.
    const problem = judgeSpecProblem(spec, `new judge ${index + 1}`, scenarioCount);
    if (problem) return problem;
  }
  if (freshJudges.length > 0) {
      // The engine has two passes, and one launch does only one: `run` plays the
      // fresh cells and has them graded by every living judge; `catchup` fills in
      // the missing verdicts on the conversations already finished. A call doing
      // both would leave the fresh judge with no verdict on everything already
      // played — half a job that was nonetheless costed and paid for. Two calls,
      // each clean.
    const alsoPlays =
      indices.length > 0 ||
      fresh.length > 0 ||
      toDeepen !== undefined ||
      (r.new_tools ?? []).length > 0 ||
      (r.turns !== undefined && r.turns !== currentTurns);
    if (alsoPlays) {
      return (
        "adding a judge is its own extension: it re-reads conversations that are already " +
        "played, while adding scenarios, models, turns or tools plays new ones. One launch " +
        "does one of the two. Send this call with new_judges alone, and the rest as a second one."
      );
    }
  }

  // Laying down a judge is content like any other: the request does not run
  // empty, it has the fresh judge reread everything already played.
  if (
    indices.length === 0 &&
    fresh.length === 0 &&
    toDeepen === undefined &&
    freshJudges.length === 0
  ) {
      // Neither a scenario to add nor an attempt to deepen: the request would
      // run empty and would still set the run going again. Deepening alone no
      // longer falls here — it continues real conversations and re-judges them,
      // which is not empty.
    return "at least one scenario, a score to deepen, or a judge to add is required";
  }

  const temperature = temperatureProblem(r.temperature);
  if (temperature) return temperature;

  return null;
}

/** Why an extension already applied is not applied again — or `null` while it
 *  is still waiting.
 *
 * Reapplying is not idempotent, and that is what makes this refusal necessary
 * rather than comfortable: `cellsForExtension` numbers the repetitions from the
 * last one, so that a second application stacks attempts instead of noting there
 * is nothing to do, and writes the `new_scenarios` a second time into the run.
 * The `added === 0` net catches only the extension that was already adding
 * nothing.
 *
 * A launched run draft, for its part, stays relaunchable: it produces one more
 * run, without touching the first. It is the same rule that is right on one side
 * and wrong on the other — hence this predicate, which holds for extensions
 * only. */
export function alreadyAppliedProblem(draft: ExtendDraft): string | null {
  if (!draft.launched_at) return null;
  return (
    `This extension was already applied to run ${draft.extends_run_id} on ` +
    `${draft.launched_at}. Applying it again would add to what it already added, not ` +
    "repeat it. See the run's Extensions history for what it did, and compose a new " +
    "extension on the run's page if you mean to go further."
  );
}

/** What forbids applying this draft to run `runId` — or `null` if it can
 *  serve.
 *
 * Three refusals, in the order in which they stop being true: it is not an
 * extension, it aims at another run, it has already served. For the HTTP route,
 * which receives the draft and the run by two independent paths — the address
 * and a parameter — and therefore has nothing guaranteeing in advance that they
 * go together. */
export function extensionDraftProblem(draft: Draft, runId: string): string | null {
  if (draft.kind !== "extend") {
    return `Draft ${draft.id} is a run to launch, not an extension of a run.`;
  }
  if (draft.extends_run_id !== runId) {
    return `Draft ${draft.id} extends run ${draft.extends_run_id}, not ${runId}.`;
  }
  return alreadyAppliedProblem(draft);
}
