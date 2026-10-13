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
  /** What each attempt the extension deepens had cost before it, by `cellKey`;
   *  `null` when that was unknown. A cell absent from it is fresh.
   *
   * Kept apart from `cells`, which the skeleton copies out to the agent: a
   * deepened cell declares what deepening it cost, and `importWrites` adds the
   * two, so this is what turns a declaration into the cell's whole cost. */
  deepenedCosts: Map<string, number | null>;
}

/** One judge's verdict on one conversation: graded (`score` on the scale),
 *  nothing to grade (`score: null`), or failed (`error`). */
export interface Grade {
  score?: number | null;
  justification?: string;
  /** `null` or `""` is no error, as a serialiser writing every field leaves it. */
  error?: string | null;
}

/** Whether a grade says its judge failed: an error that is there and says
 *  something. The checker and the writer read it the same way, so a grade
 *  accepted as graded is never written as failed. */
function judgeFailed(grade: Record<string, unknown> | Grade): boolean {
  return grade.error !== undefined && grade.error !== null && grade.error !== "";
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

/** Two judges of a run going by the same key in a document.
 *
 * An ordinary judge's slug is free text, and nothing stops one from being
 * `principal`, `awareness` or `adversary_fidelity`. A map would then keep the
 * last of the two, and a grade meant for one would be written on the other
 * without a word: refused instead, before anything is written. */
export class DuplicateJudgeKey extends Error {
  constructor(key: string) {
    super(
      `Two judges of this run would both be named "${key}" in the import document: an ` +
        "ordinary judge's slug matches the name of the principal or of a system judge. Their " +
        "grades could not be told apart, so this run cannot be imported into while both are " +
        "linked: unlink one of them, or give that judge another slug.",
    );
  }
}

/** The keys, in order, refusing a repeat: see `DuplicateJudgeKey`. */
function distinct(keys: string[]): string[] {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) throw new DuplicateJudgeKey(key);
    seen.add(key);
  }
  return keys;
}

/** The judge links an extension import writes with, by key: every live judge
 *  of the run, then the judges the extension just added, `new_judges[i]` in
 *  the order of the request. Throws `DuplicateJudgeKey` rather than let one
 *  link shadow another.
 *
 * `links` may already hold the links the extension just created: those are
 * named only by their place, never by their slug, which is free text and may
 * equal the key of a live judge (a new judge labelled "Awareness"). */
export function liveJudgeKeys(
  links: { id: string; is_principal: boolean; system_type: string; judge: { slug: string } }[],
  newRunJudgeIds: string[],
): Map<string, string> {
  const added = new Set(newRunJudgeIds);
  const entries: [string, string][] = [
    ...links
      .filter((link) => !added.has(link.id))
      .map((link): [string, string] => [judgeKey(link), link.id]),
    ...newRunJudgeIds.map((id, index): [string, string] => [`new_judges[${index}]`, id]),
  ];
  distinct(entries.map(([key]) => key));
  return new Map(entries);
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
    deepenedCosts: new Map(),
  };
}

/** What an extension draft expects, from the same plan `launch_draft` would
 *  apply (`planExtension`): its fresh cells and the attempts it deepens, graded
 *  by every live judge; or, when it adds judges, their grades on every
 *  finished conversation.
 *
 * Throws `DuplicateJudgeKey` when two live judges would go by the same key. */
export function extensionExpectation(input: {
  cases: NewCell[];
  /** With the cost each attempt stores now, from before the deepening. */
  deepened: (ExpectedCell & { cost_usd: number | null })[];
  turns: number;
  liveJudges: {
    is_principal: boolean;
    system_type: string;
    judge: { slug: string; rubric: RubricLevel[] | null };
  }[];
  newJudgeScales: number[][];
  doneConversations: CellRef[];
}): ImportExpectation {
  // Checked even when only new judges grade: the import names every live link
  // all the same (`liveJudgeKeys`), and refusing here writes nothing.
  const keys = distinct(input.liveJudges.map(judgeKey));
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
      deepenedCosts: new Map(),
    };
  }
  return {
    cells: [...input.cases, ...input.deepened].map(expectedCell),
    turns: input.turns,
    judges: input.liveJudges.map((link, index) => ({
      key: keys[index],
      scale: scaleOf(link.judge.rubric),
    })),
    conversations: [],
    newJudges: [],
    deepenedCosts: new Map(input.deepened.map((cell) => [cellKey(cell), cell.cost_usd])),
  };
}

/** What `launch_draft` says of an extension that adds nothing; an import says
 *  the same, since it is the same draft. */
export const NOTHING_TO_IMPORT = "Nothing to add: that combination is already covered.";

/** Whether the draft leaves nothing to import: no cell to play, and no new
 *  judge with a finished conversation to grade.
 *
 * Refused before anything is written. Applying such an extension would still
 * close the run with this import's cost, which is unknown when nothing is
 * played: the declared cost of everything before it would be wiped. */
export function nothingToImport(expectation: ImportExpectation): boolean {
  return (
    expectation.cells.length === 0 &&
    (expectation.newJudges.length === 0 || expectation.conversations.length === 0)
  );
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
  const seeded = message.seeded;
  if (seeded !== undefined && seeded !== null && typeof seeded !== "boolean") {
    return `${where}: seeded must be true or false.`;
  }
  return null;
}

/** A checked message reduced to the keys `Message` holds and something here
 *  reads back: the run page, a judge pass (`scoring.py`), an export.
 *
 * Whatever else an agent's own harness put on a turn (a latency, a provider's
 * reasoning, a call's `type`) is dropped rather than stored: nothing here
 * would show it, and a stored key nothing explains reads as one the
 * playground wrote. `seeded` left `null` is no flag. */
function cleanMessage(message: Record<string, unknown>): Message {
  const clean: Message = {
    role: message.role as Message["role"],
    content: message.content as string,
  };
  if (Array.isArray(message.tool_calls)) {
    clean.tool_calls = (message.tool_calls as Record<string, unknown>[]).map((call) => ({
      id: call.id as string,
      name: call.name as string,
      arguments: call.arguments as Record<string, unknown>,
    }));
  }
  if (message.tool_name !== undefined) clean.tool_name = message.tool_name as string | null;
  if (message.tool_call_id !== undefined) {
    clean.tool_call_id = message.tool_call_id as string | null;
  }
  if (typeof message.seeded === "boolean") clean.seeded = message.seeded;
  return clean;
}

/** One verdict, against its judge's scale. `null` is "not provided". */
function gradeProblem(grade: unknown, scale: number[], where: string): string | null {
  if (grade === null) return null;
  if (!isObject(grade)) return `${where} must be an object, or null when not provided.`;
  if (judgeFailed(grade)) {
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
      // Every message checked above, so each one is an object with a role and
      // a string content: only its keys are cut down here.
      cells: (cells as ImportCell[]).map((cell) =>
        Array.isArray(cell.messages)
          ? {
              ...cell,
              messages: (cell.messages as unknown as Record<string, unknown>[]).map(
                cleanMessage,
              ),
            }
          : cell,
      ),
      grades: grades as ImportGrade[],
    },
  };
}

function isPlayed(cell: ImportCell): boolean {
  return (cell.messages ?? []).length > 0;
}

/** What this import declares it cost: the document's total, or else the sum of
 *  every cell's declared cost, failed cells included, since a refused request
 *  may still bill. The sum is known only when every played cell carries a cost;
 *  a failed cell without one counts as 0, since it may have cost nothing.
 *  Unknown when nothing was played and no total is declared, and a partial sum
 *  would read as the whole. */
export function importCost(doc: ImportDocument): number | null {
  if (typeof doc.cost_usd === "number") return doc.cost_usd;
  const played = doc.cells.filter(isPlayed);
  if (played.length === 0) return null;
  if (!played.every((cell) => typeof cell.cost_usd === "number")) return null;
  return doc.cells.reduce(
    (total, cell) => total + (typeof cell.cost_usd === "number" ? cell.cost_usd : 0),
    0,
  );
}

/** A run's cost after one more import. Unknown plus anything stays unknown. */
export function addCosts(before: number | null, added: number | null): number | null {
  return before === null || added === null ? null : before + added;
}

/** The rows an import upserts, built in memory from a checked document.
 *
 * Three lists because a bulk upsert must carry the same columns on every row:
 * a played cell writes its transcript, a failed one only its error, and leaves
 * its score rows pending exactly as the engine does when a cell fails. A grade
 * left `null` writes nothing, so its row stays pending too.
 *
 * `now` is `NOW` from `supabase.ts`, passed in so this stays pure.
 *
 * A deepened cell declares what deepening it cost, not the whole conversation:
 * it stores that added to its cost from before (`deepenedCosts`, from the
 * expectation), unknown when either is. A deepening that fails without a
 * declared cost adds nothing, so the cell keeps the cost it had. A fresh cell
 * stores what it declares.
 * The run's total, `importCost`, adds the declarations alone, so no pass is
 * counted twice.
 *
 * Throws when a cell or a judge has no row: the checker has already matched
 * the document to the draft, so this can only mean the writes before it went
 * wrong, and silently skipping would lose a verdict. */
export function importWrites(
  runId: string,
  doc: ImportDocument,
  sampleIds: Map<string, string>,
  judgeIds: Map<string, string>,
  now: string,
  deepenedCosts: Map<string, number | null>,
): {
  played: Record<string, unknown>[];
  failed: Record<string, unknown>[];
  scores: Record<string, unknown>[];
} {
  const played: Record<string, unknown>[] = [];
  const failed: Record<string, unknown>[] = [];
  const scores: Record<string, unknown>[] = [];

  function sampleId(ref: CellRef): string {
    const id = sampleIds.get(cellKey(ref));
    if (!id) throw new Error(`No cell ${describe(ref)} on run ${runId}.`);
    return id;
  }
  function judgeId(key: string): string {
    const id = judgeIds.get(key);
    if (!id) throw new Error(`No judge "${key}" on run ${runId}.`);
    return id;
  }
  function score(runJudgeId: string, sample: string, grade: Grade): void {
    scores.push({
      run_judge_id: runJudgeId,
      sample_id: sample,
      run_id: runId,
      ...(judgeFailed(grade)
        ? { status: "error", score: null, justification: "", error: grade.error }
        : {
            status: "done",
            score: grade.score ?? null,
            justification: grade.justification ?? "",
            error: null,
          }),
    });
  }

  for (const cell of doc.cells) {
    const id = sampleId(cell);
    const key = cellKey(cell);
    const declared = cell.cost_usd ?? null;
    const base = {
      id,
      run_id: runId,
      scenario_index: cell.scenario_index,
      target_model: cell.target_model,
      repetition: cell.repetition,
      cost_usd: deepenedCosts.has(key)
        ? addCosts(deepenedCosts.get(key) ?? null, isPlayed(cell) ? declared : (declared ?? 0))
        : declared,
      finished_at: now,
    };
    if (!isPlayed(cell)) {
      failed.push({ ...base, status: "error", error: cell.error });
      continue;
    }
    played.push({
      ...base,
      status: "done",
      error: null,
      messages: cell.messages,
      turns_done: cell.turns_done,
      started_at: now,
    });
    for (const [key, grade] of Object.entries(cell.grades ?? {})) {
      if (grade) score(judgeId(key), id, grade);
    }
  }
  for (const item of doc.grades) {
    if (item.grade) score(judgeId(item.judge), sampleId(item), item.grade);
  }
  return { played, failed, scores };
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** One sentence for the agent: what came in, and what is left pending. */
export function importSummary(doc: ImportDocument, expectation: ImportExpectation): string {
  const played = doc.cells.filter(isPlayed).length;
  const failed = doc.cells.length - played;
  const given =
    doc.cells.reduce(
      (count, cell) => count + Object.values(cell.grades ?? {}).filter((g) => g !== null).length,
      0,
    ) + doc.grades.filter((item) => item.grade !== null).length;
  const owed =
    played * expectation.judges.length +
    expectation.conversations.length * expectation.newJudges.length;

  const parts: string[] = [];
  if (doc.cells.length > 0) {
    parts.push(`${plural(played, "conversation")} played, ${failed} failed`);
  }
  parts.push(`${plural(given, "grade")} given`);
  const pending = owed - given;
  const tail =
    pending > 0
      ? ` ${plural(pending, "grade")} left pending: the run page's catch-up button can have ` +
        `${pending === 1 ? "it" : "them"} graded here, at our cost.`
      : "";
  return `${parts.join(", ")}.${tail}`;
}

/** Refuses to have our engine play any part of an external run: its cells
 *  were played elsewhere, and a matrix is played in one place or the other.
 *  Shared by `launch_draft`, the web extend route and the retry route. */
export function playedElsewhereProblem(run: { id: string; origin: string }): string | null {
  if (run.origin !== "external") return null;
  return (
    `Run ${run.id} was played outside the playground and imported. Our engine does not ` +
    "play any of its cells: more of it comes in as an extension draft, filled with " +
    "get_import_skeleton and import_draft_results."
  );
}

/** Refuses to import an extension of a run played here, for the same reason. */
export function playedHereProblem(run: { id: string; origin: string }): string | null {
  if (run.origin === "external") return null;
  return (
    `Run ${run.id} was played by the playground itself. An extension of it is launched ` +
    "with launch_draft, never imported: a matrix is played in one place or the other."
  );
}
