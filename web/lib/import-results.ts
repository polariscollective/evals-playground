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
