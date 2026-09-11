// What an extension did, in plain words — and above all what it refuses to say.
// The counts come from the record; when the quote is missing, the sentence says
// the shape and keeps quiet about the number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseExtension } from "./extension-summary.ts";
import type {
  CostEstimate,
  EvalScenario,
  ExtendRequest,
  RunExtensionLogEntry,
} from "./types";

/** An empty request, to be completed by whatever each test puts to the test. */
const REQUEST = (extra: Partial<ExtendRequest> = {}): ExtendRequest => ({
  scenario_indices: [],
  new_scenarios: [],
  targets: [],
  repetitions: 0,
  ...extra,
});

/** A quote reduced to the only field this module reads. The cast holds because
 *  `summariseExtension` never looks at anything else on it. */
const ESTIMATE = (conversations: number): CostEstimate =>
  ({ conversations }) as unknown as CostEstimate;

const ENTRY = (
  request: ExtendRequest,
  estimate: CostEstimate | null = null,
): RunExtensionLogEntry =>
  ({
    at: "2026-09-06T16:33:42.873Z",
    by: "sam@polaris.example",
    via: "mcp",
    request,
    estimate,
    cost_before_usd: 0,
  }) as unknown as RunExtensionLogEntry;

const SCENARIO = (title: string): EvalScenario =>
  ({ title, system_prompt: "s", opening_message: "o" }) as unknown as EvalScenario;

const TWO = [SCENARIO("Batch held before shipping"), SCENARIO("Balance of a walled-off file")];

test("cells added: the sentence counts the conversations, the lines name the scenarios", () => {
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0, 1],
      targets: ["anthropic/claude-haiku-4-5"],
      repetitions: 1,
    }),
    ESTIMATE(2),
  );
  const summary = summariseExtension(entry, TWO);
  assert.deepEqual(summary.headlines, [
    "1 attempt added across 2 scenarios × 1 model — 2 conversations.",
  ]);
  assert.deepEqual(summary.lines, [
    { label: "Scenarios", values: ["Batch held before shipping", "Balance of a walled-off file"] },
    { label: "Models", values: ["anthropic/claude-haiku-4-5"] },
  ]);
});

test("an index pointing at nothing is named by its number rather than disappearing", () => {
  const entry = ENTRY(
    REQUEST({ scenario_indices: [0, 7], targets: ["m"], repetitions: 1 }),
    ESTIMATE(2),
  );
  const [scenarios] = summariseExtension(entry, TWO).lines;
  assert.deepEqual(scenarios.values, ["Batch held before shipping", "scenario 7"]);
});

test("a deepening: the count is what remains of the quote, and the starting depth is never invented", () => {
  // Nine attempts pushed, no new cell: the quote carries only those.
  const entry = ENTRY(REQUEST({ deepen: [0], turns: 4 }), ESTIMATE(9));
  const summary = summariseExtension(entry, TWO);
  assert.deepEqual(summary.headlines, ["9 attempts graded 0 pushed to 4 turns."]);
  // Nothing resembling "from 3 to 4": the earlier depth is not in the record.
  assert.ok(!summary.headlines[0].includes(" from "));
});

test("deepening \"all\": the sentence says all graded attempts, not a list of levels", () => {
  const entry = ENTRY(REQUEST({ deepen: "all", turns: 6 }), ESTIMATE(4));
  assert.deepEqual(summariseExtension(entry, TWO).headlines, [
    "4 attempts pushed to 6 turns — all those that were graded.",
  ]);
});

test("adding and deepening at once: two sentences, each with its own count", () => {
  // The quote adds the two: 2 new cells + 5 attempts pushed = 7.
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0, 1],
      targets: ["m"],
      repetitions: 1,
      deepen: [0, 1],
      turns: 5,
    }),
    ESTIMATE(7),
  );
  assert.deepEqual(summariseExtension(entry, TWO).headlines, [
    "1 attempt added across 2 scenarios × 1 model — 2 conversations.",
    "5 attempts graded 0 or 1 pushed to 5 turns.",
  ]);
});

test("with no quote, the sentence says the shape and keeps quiet about the count — never a zero", () => {
  const entry = ENTRY(REQUEST({ deepen: [0], turns: 4 }), null);
  const summary = summariseExtension(entry, TWO);
  assert.deepEqual(summary.headlines, ["Attempts graded 0 pushed to 4 turns."]);
  assert.ok(!summary.headlines[0].includes("0 attempt"));
});

test("a judge laid down: the reread is counted, and the judge is named", () => {
  const entry = ENTRY(
    REQUEST({ new_judges: [{ criterion: "Does it name the constraint?", rubric: [], model: "anthropic/claude-haiku-4-5" }] }),
    ESTIMATE(6),
  );
  const summary = summariseExtension(entry, TWO);
  assert.deepEqual(summary.headlines, [
    "1 judge added — reread over 6 conversations already played.",
  ]);
  assert.deepEqual(summary.lines, [
    { label: "Judges", values: ["Does it name the constraint? (anthropic/claude-haiku-4-5)"] },
  ]);
});

test("several judges: the total counts rereads, never conversations", () => {
  // `addEstimates` sums each judge's quote: 6 conversations × 2 judges.
  const entry = ENTRY(
    REQUEST({
      new_judges: [
        { criterion: "A", rubric: [] },
        { criterion: "B", rubric: [] },
      ],
    }),
    ESTIMATE(12),
  );
  assert.deepEqual(summariseExtension(entry, TWO).headlines, [
    "2 judges added — 12 rereads over the conversations already played.",
  ]);
});

test("tools, temperature and depth alone appear as lines", () => {
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0],
      targets: ["m"],
      repetitions: 2,
      new_tools: [{ name: "search_files", description: "d", parameters: [], result: "r" }],
      temperature: { min: 0.2, max: 0.8 },
      turns: 3,
    }),
    ESTIMATE(2),
  );
  const { lines } = summariseExtension(entry, TWO);
  assert.deepEqual(lines.map((line) => line.label), ["Scenarios", "Models", "Tools", "Temperature", "Depth"]);
  // The tool's name, not its description nor its parameters.
  assert.deepEqual(lines.find((line) => line.label === "Tools")?.values, ["search_files"]);
  // Two distinct bounds are written as a range, separated by an en dash.
  assert.deepEqual(lines.find((line) => line.label === "Temperature")?.values, ["0.2 – 0.8"]);
});

test("temperature: the range collapses to a single value with no max, or when max equals min", () => {
  const withoutMax = summariseExtension(
    ENTRY(
      REQUEST({ scenario_indices: [0], targets: ["m"], repetitions: 1, temperature: { min: 0.5 } }),
      ESTIMATE(1),
    ),
    TWO,
  );
  assert.deepEqual(
    withoutMax.lines.find((line) => line.label === "Temperature")?.values,
    ["0.5"],
  );

  const maxEqual = summariseExtension(
    ENTRY(
      REQUEST({
        scenario_indices: [0],
        targets: ["m"],
        repetitions: 1,
        temperature: { min: 0.5, max: 0.5 },
      }),
      ESTIMATE(1),
    ),
    TWO,
  );
  assert.deepEqual(
    maxEqual.lines.find((line) => line.label === "Temperature")?.values,
    ["0.5"],
  );
});

test("the cell count is the product scenarios × models × repetitions — the one formula, held here and by cellsForExtension", () => {
  // The shape `planExtension` would build: several indices, several targets,
  // repetitions beyond 1 — so that the product cannot slip past a factor worth
  // 1 without saying so.
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0, 1],
      targets: ["m1", "m2", "m3"],
      repetitions: 4,
    }),
    ESTIMATE(24),
  );
  const summary = summariseExtension(entry, TWO);
  // 2 scenarios × 3 models × 4 repetitions = 24: exactly what the quote carries.
  assert.deepEqual(summary.headlines, [
    "4 attempts added across 2 scenarios × 3 models — 24 conversations.",
  ]);
});

test("an entry that asked for nothing: no sentence, no line", () => {
  assert.deepEqual(summariseExtension(ENTRY(REQUEST()), TWO), {
    headlines: [],
    lines: [],
  });
});

test("an extension that gave the run its adversary says so", () => {
  // A run of one turn has nobody to push, and an extension that takes it deeper
  // lays down the first adversary — a change to the run's setting, not just to
  // its size. The record carries it; the history has only to read it.
  const { lines } = summariseExtension(
    ENTRY(
      REQUEST({
        scenario_indices: [0],
        targets: ["anthropic/claude-sonnet-5"],
        repetitions: 1,
        turns: 4,
        adversary: "grok/grok-4.6",
        adversary_prompt: "You play a customer in a hurry.",
      }),
    ),
    [],
  );
  const adversary = lines.find((line) => line.label === "Adversary");
  assert.deepEqual(adversary?.values, ["grok/grok-4.6"]);
});

test("an extension that touched no adversary says nothing about one", () => {
  const { lines } = summariseExtension(
    ENTRY(REQUEST({ scenario_indices: [0], targets: ["m"], repetitions: 1 })),
    [],
  );
  assert.equal(
    lines.some((line) => line.label === "Adversary"),
    false,
  );
});
