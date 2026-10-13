// What an agent that played a run outside the playground hands over, and
// whether it fits the draft it claims to fill. See the design,
// docs/superpowers/specs/2026-10-13-external-run-import-design.md.
//
// Pure, like `cells.ts` and `launch-judges.ts`: `runs.ts` imports
// `server-only`, which breaks under `node --test`, and everything worth testing
// about an import is decided here, before the first write.
import { cellsForRun, type NewCell } from "./cells.ts";
import type {
  EvalRunConfig,
  JudgeSystemType,
  Message,
  RubricLevel,
} from "./types";

/** A cell by the triple that is unique on a run. */
export interface CellRef {
  scenario_index: number;
  target_model: string;
  repetition: number;
}

/** A cell the draft expects, with the temperature it planned for it. */
export interface ExpectedCell extends CellRef {
  temperature: number | null;
}

/** A judge an import may grade with, by the key the document uses for it, and
 *  the values of its scale. */
export interface ExpectedJudge {
  key: string;
  scale: number[];
}

/** Everything a draft lets an import write, and nothing else.
 *
 * `cells` and `judges` go together: each cell is played or failed, and each
 * played cell may carry a grade from each judge. `conversations` and
 * `newJudges` go together: an extension that adds judges plays nothing, and
 * asks for their grades on every conversation already finished. The two pairs
 * never both hold something, since `extendProblem` refuses an extension that
 * adds judges and anything else. */
export interface ImportExpectation {
  cells: ExpectedCell[];
  /** The most turns a played cell may report. */
  turns: number;
  judges: ExpectedJudge[];
  conversations: CellRef[];
  newJudges: ExpectedJudge[];
}

/** One judge's verdict on one conversation: graded (`score` on the scale),
 *  nothing to grade (`score: null`), or failed (`error`). */
export interface Grade {
  score?: number | null;
  justification?: string;
  error?: string;
}

/** One cell as the document carries it: played (`messages`) or failed
 *  (`error`). A grade left `null` is not provided, and stays pending. */
export interface ImportCell extends CellRef {
  temperature?: number | null;
  turns_done?: number | null;
  messages?: Message[];
  error?: string;
  cost_usd?: number | null;
  grades?: Record<string, Grade | null>;
}

/** A new judge's verdict on a conversation already in the run. */
export interface ImportGrade extends CellRef {
  judge: string;
  grade: Grade | null;
}

export interface ImportDocument {
  cost_usd?: number | null;
  cells: ImportCell[];
  grades: ImportGrade[];
}

/** How the document names the two system judges. Words an agent can read,
 *  rather than the column's values. */
export const SYSTEM_KEYS: Record<JudgeSystemType, string> = {
  awake: "awareness",
  faithful_adversary: "adversary_fidelity",
};

export function cellKey(ref: CellRef): string {
  return `${ref.scenario_index}|${ref.target_model}|${ref.repetition}`;
}

function isSystemType(value: string): value is JudgeSystemType {
  return Object.hasOwn(SYSTEM_KEYS, value);
}

function scaleOf(rubric: RubricLevel[] | null | undefined): number[] {
  return (rubric ?? []).map((level) => level.value);
}

function expectedCell(cell: CellRef & { temperature: number | null }): ExpectedCell {
  return {
    scenario_index: cell.scenario_index,
    target_model: cell.target_model,
    repetition: cell.repetition,
    temperature: cell.temperature,
  };
}

/** The key a live judge of an existing run goes by in the document. An
 *  ordinary judge goes by its slug: unique across the library, and what MCP
 *  already names judges by. */
export function judgeKey(link: {
  is_principal: boolean;
  system_type: string;
  judge: { slug: string };
}): string {
  if (link.is_principal) return "principal";
  if (isSystemType(link.system_type)) return SYSTEM_KEYS[link.system_type];
  return link.judge.slug;
}

/** The keys of a fresh run's links, as `judgesForLaunch` built them: the
 *  principal, then `config.judges` in their order, then the system judges.
 *
 * Read from the rows in memory rather than from the database: a single insert
 * gives every link the same `created_at`, and nothing read back afterwards
 * could tell `judges[0]` from `judges[1]`. */
export function launchJudgeKeys(
  runJudges: { id: string; is_principal: boolean; system_type: string }[],
): Map<string, string> {
  const keys = new Map<string, string>();
  let secondary = 0;
  for (const link of runJudges) {
    if (link.is_principal) keys.set("principal", link.id);
    else if (isSystemType(link.system_type)) keys.set(SYSTEM_KEYS[link.system_type], link.id);
    else keys.set(`judges[${secondary++}]`, link.id);
  }
  return keys;
}

/** What a run draft expects: every cell of its matrix, and every judge
 *  `judgesForLaunch` would link.
 *
 * `config` is the settled configuration (`settleReusedJudges`), so a judge
 * named by handle already carries its scale. `system` is the two seeded rows,
 * read by `reusedJudges`. */
export function runExpectation(
  config: EvalRunConfig,
  system: Partial<Record<JudgeSystemType, { rubric: RubricLevel[] | null }>>,
): ImportExpectation {
  const judges: ExpectedJudge[] = [{ key: "principal", scale: scaleOf(config.rubric) }];
  for (const [index, spec] of (config.judges ?? []).entries()) {
    judges.push({ key: `judges[${index}]`, scale: scaleOf(spec.rubric) });
  }
  if (config.check_eval_awareness !== false) {
    judges.push({ key: SYSTEM_KEYS.awake, scale: scaleOf(system.awake?.rubric) });
  }
  if (config.check_adversary_fidelity === true) {
    judges.push({
      key: SYSTEM_KEYS.faithful_adversary,
      scale: scaleOf(system.faithful_adversary?.rubric),
    });
  }
  return {
    cells: cellsForRun(config).map(expectedCell),
    turns: config.turns,
    judges,
    conversations: [],
    newJudges: [],
  };
}

/** What an extension draft expects, from the same plan `launch_draft` would
 *  apply (`planExtension`): its fresh cells and the attempts it deepens, graded
 *  by every live judge; or, when it adds judges, their grades on every
 *  finished conversation. */
export function extensionExpectation(input: {
  cases: NewCell[];
  deepened: ExpectedCell[];
  turns: number;
  liveJudges: {
    is_principal: boolean;
    system_type: string;
    judge: { slug: string; rubric: RubricLevel[] | null };
  }[];
  newJudgeScales: number[][];
  doneConversations: CellRef[];
}): ImportExpectation {
  if (input.newJudgeScales.length > 0) {
    return {
      cells: [],
      turns: input.turns,
      judges: [],
      conversations: input.doneConversations.map((ref) => ({
        scenario_index: ref.scenario_index,
        target_model: ref.target_model,
        repetition: ref.repetition,
      })),
      newJudges: input.newJudgeScales.map((scale, index) => ({
        key: `new_judges[${index}]`,
        scale,
      })),
    };
  }
  return {
    cells: [...input.cases, ...input.deepened].map(expectedCell),
    turns: input.turns,
    judges: input.liveJudges.map((link) => ({
      key: judgeKey(link),
      scale: scaleOf(link.judge.rubric),
    })),
    conversations: [],
    newJudges: [],
  };
}

/** The document to fill, every entry present and every value to provide left
 *  empty.
 *
 * Grades are `null`, never `{ score: null, justification: "" }`: that second
 * form means "nothing to grade", and a skeleton returned untouched must not
 * read as a judge's verdict. `messages` is empty, so an untouched cell is
 * refused as neither played nor failed. */
export function importSkeleton(expectation: ImportExpectation): ImportDocument {
  const blank = Object.fromEntries(expectation.judges.map((judge) => [judge.key, null]));
  return {
    cost_usd: null,
    cells: expectation.cells.map((cell) => ({
      ...cell,
      turns_done: null,
      messages: [],
      cost_usd: null,
      grades: { ...blank },
    })),
    grades: expectation.newJudges.flatMap((judge) =>
      expectation.conversations.map((ref) => ({ ...ref, judge: judge.key, grade: null })),
    ),
  };
}

const ROLES = new Set(["user", "assistant", "tool"]);

/** How many entries a refusal names before saying how many more there are. */
const LISTED = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(ref: CellRef): string {
  return `scenario ${ref.scenario_index}, ${ref.target_model}, repetition ${ref.repetition}`;
}

function listed(items: string[]): string {
  const shown = items.slice(0, LISTED).join("; ");
  return items.length > LISTED ? `${shown}; and ${items.length - LISTED} more` : shown;
}

function refOf(value: unknown): CellRef | null {
  if (!isObject(value)) return null;
  const { scenario_index, target_model, repetition } = value;
  if (
    !Number.isInteger(scenario_index) ||
    typeof target_model !== "string" ||
    !Number.isInteger(repetition)
  ) {
    return null;
  }
  return {
    scenario_index: scenario_index as number,
    target_model,
    repetition: repetition as number,
  };
}

function costProblem(cost: unknown, where: string): string | null {
  if (cost === undefined || cost === null) return null;
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0) {
    return `${where} must be a non-negative number of US dollars, or null.`;
  }
  return null;
}

/** The shape `eval_samples.messages` holds (`Message`, `types.ts`), and that
 *  the run page and a later deepening read back without checking again. */
function messageProblem(message: unknown, where: string): string | null {
  if (!isObject(message)) return `${where} is not an object.`;
  if (typeof message.role !== "string" || !ROLES.has(message.role)) {
    return `${where}: role must be "user", "assistant" or "tool".`;
  }
  if (typeof message.content !== "string") return `${where}: content must be a string.`;
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) return `${where}: tool_calls must be a list.`;
    for (const [index, call] of message.tool_calls.entries()) {
      if (
        !isObject(call) ||
        typeof call.id !== "string" ||
        typeof call.name !== "string" ||
        !isObject(call.arguments)
      ) {
        return `${where}: tool_calls[${index}] needs a string id, a string name and an arguments object.`;
      }
    }
  }
  for (const field of ["tool_name", "tool_call_id"] as const) {
    const value = message[field];
    if (value !== undefined && value !== null && typeof value !== "string") {
      return `${where}: ${field} must be a string.`;
    }
  }
  return null;
}

/** One verdict, against its judge's scale. `null` is "not provided". */
function gradeProblem(grade: unknown, scale: number[], where: string): string | null {
  if (grade === null) return null;
  if (!isObject(grade)) return `${where} must be an object, or null when not provided.`;
  if (grade.error !== undefined) {
    if (typeof grade.error !== "string" || grade.error.trim() === "") {
      return `${where}: error must be a sentence saying why the judge failed.`;
    }
    if (grade.score !== undefined && grade.score !== null) {
      return `${where} carries both a score and an error: a judge either graded or failed.`;
    }
    return null;
  }
  if (grade.score === undefined) {
    return `${where}: score is missing. Use null when there was nothing to grade.`;
  }
  if (typeof grade.justification !== "string") return `${where}: justification must be a string.`;
  if (grade.score === null) return null;
  if (typeof grade.score !== "number" || !scale.includes(grade.score)) {
    return (
      `${where}: ${JSON.stringify(grade.score)} is not on this judge's scale ` +
      `(${scale.join(", ")}). Use null when there was nothing to grade.`
    );
  }
  return null;
}

/** Whether `raw` fills exactly what `expectation` allows, and the document if
 *  it does.
 *
 * Every problem found is returned, not only the first: the agent fixes a
 * document in one round trip rather than one per mistake. Nothing is written
 * by the caller unless this passes. */
export function checkImport(
  raw: string,
  expectation: ImportExpectation,
): { doc: ImportDocument } | { problems: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { problems: [`results is not valid JSON: ${(error as Error).message}`] };
  }
  if (!isObject(parsed)) {
    return { problems: ["results must be a JSON object holding cells and grades."] };
  }

  const problems: string[] = [];
  const cost = costProblem(parsed.cost_usd, "cost_usd");
  if (cost) problems.push(cost);

  const cells = parsed.cells ?? [];
  const grades = parsed.grades ?? [];
  if (!Array.isArray(cells)) problems.push("cells must be a list.");
  if (!Array.isArray(grades)) problems.push("grades must be a list.");
  if (!Array.isArray(cells) || !Array.isArray(grades)) return { problems };

  const expected = new Map(expectation.cells.map((cell) => [cellKey(cell), cell]));
  const scales = new Map(expectation.judges.map((judge) => [judge.key, judge.scale]));
  const seen = new Set<string>();
  const unexpected: string[] = [];

  for (const [index, cell] of cells.entries()) {
    const where = `cells[${index}]`;
    const ref = refOf(cell);
    if (!ref) {
      problems.push(`${where} needs scenario_index, target_model and repetition.`);
      continue;
    }
    const key = cellKey(ref);
    const planned = expected.get(key);
    if (!planned) {
      unexpected.push(describe(ref));
      continue;
    }
    const label = `${where} (${describe(ref)})`;
    if (seen.has(key)) {
      problems.push(`${label} appears twice.`);
      continue;
    }
    seen.add(key);

    const entry = cell as Record<string, unknown>;
    if (entry.temperature !== undefined && entry.temperature !== planned.temperature) {
      problems.push(
        `${label}: temperature ${JSON.stringify(entry.temperature)} is not the planned ` +
          `${JSON.stringify(planned.temperature)}.`,
      );
    }
    const played = Array.isArray(entry.messages) && entry.messages.length > 0;
    const failed = typeof entry.error === "string" && entry.error.trim() !== "";
    if (played && failed) {
      problems.push(`${label} has both messages and an error: a cell was either played or it failed.`);
      continue;
    }
    if (!played && !failed) {
      problems.push(`${label} has neither messages nor an error.`);
      continue;
    }
    const cellCost = costProblem(entry.cost_usd, `${label}: cost_usd`);
    if (cellCost) problems.push(cellCost);

    if (failed) {
      const graded =
        isObject(entry.grades) && Object.values(entry.grades).some((grade) => grade !== null);
      if (graded) {
        problems.push(`${label} failed, so no judge can have graded it: leave its grades null.`);
      }
      continue;
    }

    const messages = entry.messages as unknown[];
    if (isObject(messages[0]) && messages[0].role !== "user") {
      problems.push(`${label}: the conversation must open with the user's message.`);
    }
    for (const [position, message] of messages.entries()) {
      const issue = messageProblem(message, `${label}: messages[${position}]`);
      if (issue) {
        problems.push(issue);
        break;
      }
    }
    const turns = entry.turns_done;
    if (!Number.isInteger(turns) || (turns as number) < 0 || (turns as number) > expectation.turns) {
      problems.push(`${label}: turns_done must be a whole number from 0 to ${expectation.turns}.`);
    }
    if (entry.grades !== undefined) {
      if (!isObject(entry.grades)) {
        problems.push(`${label}: grades must be an object keyed by judge.`);
        continue;
      }
      for (const [judge, grade] of Object.entries(entry.grades)) {
        const scale = scales.get(judge);
        if (!scale) {
          problems.push(
            `${label}: no judge "${judge}" grades this run. Expected: ${[...scales.keys()].join(", ")}.`,
          );
          continue;
        }
        const issue = gradeProblem(grade, scale, `${label}: grades.${judge}`);
        if (issue) problems.push(issue);
      }
    }
  }

  if (unexpected.length > 0) problems.push(`Not part of this draft: ${listed(unexpected)}.`);
  const missing = expectation.cells.filter((cell) => !seen.has(cellKey(cell))).map(describe);
  if (missing.length > 0) {
    problems.push(`Missing, each needs messages or an error: ${listed(missing)}.`);
  }

  const conversations = new Set(expectation.conversations.map(cellKey));
  const newScales = new Map(expectation.newJudges.map((judge) => [judge.key, judge.scale]));
  const graded = new Set<string>();
  for (const [index, item] of grades.entries()) {
    const where = `grades[${index}]`;
    const ref = refOf(item);
    if (!ref || typeof (item as Record<string, unknown>).judge !== "string") {
      problems.push(`${where} needs scenario_index, target_model, repetition and judge.`);
      continue;
    }
    const entry = item as Record<string, unknown>;
    const judge = entry.judge as string;
    const label = `${where} (${describe(ref)}, ${judge})`;
    const scale = newScales.get(judge);
    if (!scale) {
      problems.push(
        newScales.size === 0
          ? `${label}: this draft adds no judge, so grades must be empty.`
          : `${label}: no new judge "${judge}". Expected: ${[...newScales.keys()].join(", ")}.`,
      );
      continue;
    }
    if (!conversations.has(cellKey(ref))) {
      problems.push(`${label}: not a finished conversation of this run.`);
      continue;
    }
    const key = `${cellKey(ref)}|${judge}`;
    if (graded.has(key)) {
      problems.push(`${label} appears twice.`);
      continue;
    }
    graded.add(key);
    const issue = gradeProblem(entry.grade, scale, `${label}: grade`);
    if (issue) problems.push(issue);
  }

  if (problems.length > 0) return { problems };
  return {
    doc: {
      cost_usd: (parsed.cost_usd as number | null | undefined) ?? null,
      cells: cells as ImportCell[],
      grades: grades as ImportGrade[],
    },
  };
}
