// The export, from the point of view of what the multiple judges change in it.
//
// Before this project, a cell carried one grade and one justification — columns
// of `EvalSample` that the migration
// `20260906093000_drop_eval_samples_score_columns.sql` (polaris-supabase
// repository) dropped: what a judge returns now lives in `judge_scores`, one row
// per (judge, conversation). `detailsCsv` and `runMarkdown` therefore also take
// `judges: RunJudgeView[]` — the run's living judges and their verdicts, as
// `attachJudges` (`lib/runs.ts`) already joins them for the screen.
//
// The rest of `detailsCsv`/`runMarkdown` (scenarios, tools, transcript...) was
// already exercised on every real export before this project; this file covers
// only what the multiple judges add or change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AWAKE_TYPE, AWARENESS_ALARM } from "./awareness.ts";
import { parseCsv } from "./csv.ts";
import { detailsCsv, matrixCsv, runMarkdown } from "./exports.ts";
import type {
  EvalRun,
  EvalRunConfig,
  EvalSample,
  Judge,
  JudgeVerdictEntry,
  RunJudgeView,
} from "./types.ts";

function sample(overrides: Partial<EvalSample> = {}): EvalSample {
  return {
    id: "s",
    run_id: "r",
    scenario_index: 0,
    scenario_title: "T",
    target_model: "anthropic/claude-haiku-4-5",
    repetition: 0,
    status: "done",
    temperature: null,
    turns_done: 4,
    messages: [],
    error: null,
    started_at: null,
    finished_at: null,
    usage: {},
    cost_usd: null,
    ...overrides,
  };
}

function config(overrides: Partial<EvalRunConfig> = {}): EvalRunConfig {
  return {
    scenarios: [{ title: "S", system_prompt: "", opening_message: "" }],
    criterion: "The model held the line.",
    rubric: [
      { value: 0, meaning: "No." },
      { value: 1, meaning: "Yes." },
    ],
    turns: 1,
    repetitions: 1,
    models: {
      targets: ["anthropic/claude-haiku-4-5"],
      judge: "anthropic/claude-haiku-4-5",
    },
    adversary_prompt: "",
    ...overrides,
  };
}

// A cast, as elsewhere in this repository (see run-extensions.test.mts): neither
// `detailsCsv` nor `runMarkdown` looks at the fields omitted here.
function run(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "r",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    started_at: null,
    finished_at: null,
    user_email: "someone@polaris.example",
    label: "Test run",
    status: "done",
    error: null,
    config: config(),
    notes: "",
    analysis: "",
    is_public: false,
    deleted_at: null,
    total_samples: 1,
    usage: {},
    cost_usd: null,
    rejudged_at: null,
    awareness_judged_at: null,
    execution: null,
    origin: "local",
    estimate: null,
    extensions: [],
    draft_id: null,
    launched_via: "ui",
    ...overrides,
  } as EvalRun;
}

function judge(overrides: Partial<Judge> = {}): Judge {
  return {
    id: "j",
    criterion: "The model held the line.",
    rubric: [
      { value: 0, meaning: "No." },
      { value: 1, meaning: "Yes." },
    ],
    model: "anthropic/claude-haiku-4-5",
    system_type: "ordinary",
    created_by: "someone@polaris.example",
    created_at: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

function verdict(overrides: Partial<JudgeVerdictEntry> = {}): JudgeVerdictEntry {
  return { status: "done", score: 1, justification: "", error: null, ...overrides };
}

/** A living link, as `attachJudges` (`lib/runs.ts`) returns it: the judge's
 *  identity, its role on this run, and its verdict per cell. */
function runJudge(
  judgeOverrides: Partial<Judge>,
  extra: { isPrincipal?: boolean; scores?: Record<string, JudgeVerdictEntry> } = {},
): RunJudgeView {
  const j = judge(judgeOverrides);
  return {
    run_judge_id: j.id,
    judge: j,
    is_principal: extra.isPrincipal ?? false,
    system_type: j.system_type,
    scores: extra.scores ?? {},
  };
}

test("the detailed CSV carries one row per cell and per judge not deleted", () => {
  const principal = runJudge(
    { id: "p", criterion: "Did it refuse?", model: "anthropic/claude-haiku-4-5" },
    { isPrincipal: true, scores: { s: verdict({ score: 1, justification: "Refused." }) } },
  );
  const secondary = runJudge(
    { id: "sec", criterion: "Did it explain why?", model: "openai/gpt-5.6-terra" },
    { isPrincipal: false, scores: { s: verdict({ score: 0, justification: "Did not explain." }) } },
  );

  const csv = detailsCsv(run(), [sample()], [principal, secondary]);
  const lines = csv.split("\n");
  const header = lines[0].split(",");

  // One header row, two data rows — one per judge, never one more column: the
  // number of judges varies from one run to the next.
  assert.equal(lines.length, 3);

  const idx = (name: string) => header.indexOf(name);
  assert.ok(idx("judge_model") >= 0);
  assert.ok(idx("judge_is_principal") >= 0);

  const principalRow = lines[1].split(",");
  const secondaryRow = lines[2].split(",");
  assert.equal(principalRow[idx("judge_is_principal")], "true");
  assert.equal(principalRow[idx("judge_model")], "anthropic/claude-haiku-4-5");
  assert.equal(principalRow[idx("judge_criterion")], "Did it refuse?");
  assert.equal(principalRow[idx("score")], "1");
  assert.equal(secondaryRow[idx("judge_is_principal")], "false");
  assert.equal(secondaryRow[idx("judge_model")], "openai/gpt-5.6-terra");
  assert.equal(secondaryRow[idx("judge_criterion")], "Did it explain why?");
  assert.equal(secondaryRow[idx("score")], "0");
});

test("the detailed CSV distinguishes graded, ungraded, pending and judge fallen over", () => {
  // It is the reflex of this whole product: those four outcomes never mix, and
  // must stay legible as such even in a spreadsheet.
  const graded = runJudge({ id: "a" }, { scores: { s: verdict({ score: 1 }) } });
  const ungraded = runJudge({ id: "b" }, { scores: { s: verdict({ score: null }) } });
  const pending = runJudge({ id: "c" }, { scores: {} }); // no row for "s"
  const fallenOver = runJudge(
    { id: "d" },
    { scores: { s: verdict({ status: "error", score: null, error: "RateLimitError: boom" }) } },
  );

  const csv = detailsCsv(run(), [sample()], [graded, ungraded, pending, fallenOver]);
  const [headerLine, ...rows] = csv.split("\n");
  const header = headerLine.split(",");
  const idx = (name: string) => header.indexOf(name);

  // One row per judge, in the order `judges` gives them.
  const [row1, row2, row3, row4] = rows.map((line) => line.split(","));

  assert.equal(row1[idx("judge_status")], "done");
  assert.equal(row1[idx("score")], "1");
  assert.equal(row1[idx("judge_error")], "");

  assert.equal(row2[idx("judge_status")], "done");
  assert.equal(row2[idx("score")], "", "ungraded: the column stays empty, never zero");
  assert.equal(row2[idx("judge_error")], "");

  assert.equal(row3[idx("judge_status")], "pending");
  assert.equal(row3[idx("score")], "");

  assert.equal(row4[idx("judge_status")], "error");
  assert.equal(row4[idx("score")], "", "a judge that fell over never returns a grade");
  assert.match(row4[idx("judge_error")], /RateLimitError: boom/);
});

test("the awareness judge carries its fixed question in the CSV, never an empty criterion", () => {
  const awake = runJudge(
    { id: "awake", system_type: AWAKE_TYPE, criterion: null, rubric: null },
    { scores: { s: verdict({ score: AWARENESS_ALARM }) } },
  );
  const csv = detailsCsv(run(), [sample()], [awake]);
  const [headerLine, dataLine] = csv.split("\n");
  const header = headerLine.split(",");
  const row = dataLine.split(",");
  assert.equal(row[header.indexOf("judge_system_type")], "awake");
  assert.match(row[header.indexOf("judge_criterion")], /eval-awareness|test/i);
  assert.notEqual(row[header.indexOf("judge_criterion")], "");
});

test("a judge unlinked since appears nowhere in the detailed CSV", () => {
  // `judges` arrives already filtered by the caller (`loadLiveRunJudges`): this
  // file only enumerates what it is given, never its own filter on `deleted_at`.
  // An unlinked judge is simply no longer in the list the caller builds — this
  // test simulates it by building the unlinked judge without ever passing it to
  // `detailsCsv`.
  const alive = runJudge({ id: "alive", criterion: "Still there." }, { isPrincipal: true });
  const unlinked = runJudge({
    id: "unlinked",
    criterion: "A criterion that must never appear again.",
  });
  void unlinked; // never passed to `detailsCsv`: that is the whole test.
  const csv = detailsCsv(run(), [sample()], [alive]);
  assert.ok(!csv.includes("A criterion that must never appear again."));
  assert.equal(csv.split("\n").length, 2);
});

test("with no living judge, the cell keeps its row, with empty judge columns", () => {
  const csv = detailsCsv(run(), [sample()], []);
  const [headerLine, dataLine] = csv.split("\n");
  const header = headerLine.split(",");
  const row = dataLine.split(",");
  assert.equal(row[header.indexOf("judge_status")], "");
  assert.equal(row[header.indexOf("score")], "");
  // The cell itself has not disappeared: its own columns still hold.
  assert.equal(row[header.indexOf("target_model")], "anthropic/claude-haiku-4-5");
});

// The matrix CSV, from the point of view of the correction: before it,
// `matrixCsv` faithfully copied the screen's limit ("follows the principal,
// never a secondary") into a file that no longer has that density constraint
// once downloaded — exactly the flaw already fixed once for the awareness badge.
// The tests below check the shape chosen: one row per (scenario, judge not
// deleted).
//
// `parseCsv` (`lib/csv.ts`, already tested on the scenarios CSV) rather than a
// naive `split(",")`: several columns of this matrix themselves hold a comma
// inside quotes (awareness's `judge_rubric`, `cell_meaning` with a remapping) —
// a naive split then misaligns everything that follows on the row.

test("the matrix CSV carries one row per living judge, principal and secondaries included", () => {
  const principal = runJudge(
    { id: "p", model: "anthropic/claude-haiku-4-5" },
    { isPrincipal: true, scores: { s: verdict({ score: 1 }) } },
  );
  const secondary = runJudge(
    { id: "sec", model: "openai/gpt-5.6-terra" },
    { isPrincipal: false, scores: { s: verdict({ score: 0 }) } },
  );
  const csv = matrixCsv(run(), [sample()], [principal, secondary]);
  const { rows } = parseCsv(csv);

  // Two data rows — one per living judge, never one more column: the number of
  // judges varies from one run to the next.
  assert.equal(rows.length, 2);

  const principalRow = rows.find((row) => row.judge_is_principal === "true");
  const secondaryRow = rows.find((row) => row.judge_is_principal === "false");
  assert.ok(principalRow, "the principal's row must exist");
  assert.ok(secondaryRow, "the secondary's row must not have disappeared");
  assert.equal(principalRow!.judge_model, "anthropic/claude-haiku-4-5");
  assert.equal(principalRow!["anthropic/claude-haiku-4-5"], "1.00");
  assert.equal(secondaryRow!.judge_model, "openai/gpt-5.6-terra");
  assert.equal(secondaryRow!["anthropic/claude-haiku-4-5"], "0.00");
});

test("the matrix CSV also carries the awareness judge, on its own fixed scale", () => {
  // "Awareness included": the user said so explicitly, and it is precisely the
  // case that had already bitten this repository once (the badge on screen, with
  // no export to carry it).
  const principal = runJudge({ id: "p" }, { isPrincipal: true, scores: { s: verdict({ score: 1 }) } });
  const awake = runJudge(
    { id: "awake", system_type: AWAKE_TYPE, criterion: null, rubric: null },
    { scores: { s: verdict({ score: 8 }) } },
  );
  const csv = matrixCsv(run(), [sample()], [principal, awake]);
  const { rows } = parseCsv(csv);
  const awakeRow = rows.find((row) => row.judge_system_type === "awake");
  assert.ok(awakeRow, "the awareness judge's row must not be missing");
  assert.equal(awakeRow!["anthropic/claude-haiku-4-5"], "8.00");
  assert.match(awakeRow!.judge_criterion, /eval-awareness|test/i);
});

test("an unlinked judge appears nowhere in the matrix CSV", () => {
  const alive = runJudge({ id: "alive" }, { isPrincipal: true, scores: { s: verdict({ score: 1 }) } });
  const unlinked = runJudge(
    { id: "unlinked", criterion: "A criterion that must never appear again." },
    { scores: { s: verdict({ score: 0 }) } },
  );
  void unlinked; // never passed to `matrixCsv`: that is the whole test.
  const csv = matrixCsv(run(), [sample()], [alive]);
  assert.ok(!csv.includes("A criterion that must never appear again."));
  assert.equal(parseCsv(csv).rows.length, 1);
});

test("the matrix CSV falls back on the scale each judge really laid down", () => {
  // `judge.rubric` takes precedence over `run.config.rubric`, which is only the
  // historical value frozen at launch — a re-judgement with another scale must
  // not be read on the old one, and that for any judge, not only the principal.
  // The RUN's scale here excludes 20 from the mean: if `matrixCsv` got it wrong,
  // the cell would be empty rather than at 20.00 — enough to tell the two scales
  // apart rather than confusing them by coincidence (a grade figuring in NEITHER
  // scale would otherwise be included in both cases, which would prove nothing).
  const principal = runJudge(
    { id: "p", rubric: [{ value: 10, meaning: "No." }, { value: 20, meaning: "Yes." }] },
    { isPrincipal: true, scores: { s: verdict({ score: 20 }) } },
  );
  const csv = matrixCsv(
    run({
      config: config({
          rubric: [
            { value: 10, meaning: "No." },
            { value: 20, meaning: "Yes.", excluded: true },
          ],
      }),
    }),
    [sample()],
    [principal],
  );
  const { rows } = parseCsv(csv);
  assert.equal(rows[0]["anthropic/claude-haiku-4-5"], "20.00");
});

test("the view's scale remapping only ever applies to the principal", () => {
  // A remapping chosen while looking at the principal's rubric (1 becomes 5) has
  // no reason to apply to a secondary judge's rubric, even if it shares the same
  // raw values — applying it all the same would lie about what its grade becomes.
  // Only the aggregate, being generic, is taken up for every judge.
  const principal = runJudge(
    { id: "p", rubric: [{ value: 0, meaning: "No." }, { value: 1, meaning: "Yes." }] },
    { isPrincipal: true, scores: { s: verdict({ score: 1 }) } },
  );
  const secondary = runJudge(
    { id: "sec", rubric: [{ value: 0, meaning: "No." }, { value: 1, meaning: "Yes." }] },
    { isPrincipal: false, scores: { s: verdict({ score: 1 }) } },
  );
  const view = { aggregate: "mean" as const, remap: { 1: 5 } };
  const csv = matrixCsv(run(), [sample()], [principal, secondary], view);
  const { rows } = parseCsv(csv);
  const principalRow = rows.find((row) => row.judge_is_principal === "true")!;
  const secondaryRow = rows.find((row) => row.judge_is_principal === "false")!;
  assert.equal(principalRow["anthropic/claude-haiku-4-5"], "5.00");
  assert.equal(secondaryRow["anthropic/claude-haiku-4-5"], "1.00");
});

test("with no living judge, the matrix stays pending rather than meaningless", () => {
  const csv = matrixCsv(run(), [sample()], []);
  const { rows } = parseCsv(csv);
  assert.equal(rows[0]["anthropic/claude-haiku-4-5"], "");
  assert.equal(rows[0].judge_is_principal, "");
  // The scenario, for its part, does not disappear.
  assert.equal(rows[0].scenario_title, "S");
});

test("the markdown summary says which secondary judges ran", () => {
  const principal = runJudge({ id: "p", criterion: "The principal's question." }, { isPrincipal: true });
  const sec1 = runJudge(
    { id: "s1", criterion: "First secondary question.", model: "openai/gpt-5.6-terra" },
    { isPrincipal: false },
  );
  const sec2 = runJudge(
    { id: "s2", criterion: "Second secondary question.", model: "grok/grok-4.3" },
    { isPrincipal: false },
  );
  const text = runMarkdown(run(), [sample()], [principal, sec1, sec2]);
  assert.match(text, /## Other judges \(2\)/);
  assert.match(text, /First secondary question\./);
  assert.match(text, /Second secondary question\./);
  assert.match(text, /openai\/gpt-5\.6-terra/);
  assert.match(text, /grok\/grok-4\.3/);
  // The principal does have its own section above ("The principal judge") but is
  // never recounted among the "other judges": its criterion appears only once in
  // the whole summary.
  const occurrences = text.split("The principal's question.").length - 1;
  assert.equal(occurrences, 1);
});

test("the markdown summary shows no \"other judges\" section with no secondary", () => {
  const principal = runJudge({ id: "p" }, { isPrincipal: true });
  const text = runMarkdown(run(), [sample()], [principal]);
  assert.doesNotMatch(text, /## Other judges/);
});

test("with no judges loaded, the summary falls back on the run's historical fields", () => {
  // `judges` empty (a route that did not ask for `withJudges`, or a run with no
  // living link): the old shape stays valid, and still describes the principal
  // through `config.criterion`/`config.rubric`/`config.models.judge`.
  const text = runMarkdown(
    run({ config: config({ criterion: "The run's historical criterion." }) }),
    [sample()],
    [],
  );
  assert.match(text, /The run's historical criterion\./);
});

test("the markdown summary says the awareness judge was on, and its outcome", () => {
  const awake = runJudge(
    { id: "awake", system_type: AWAKE_TYPE, criterion: null, rubric: null },
    {
      isPrincipal: false,
      scores: {
        s1: verdict({ score: AWARENESS_ALARM }),
        s2: verdict({ score: 2 }),
      },
    },
  );
  const principal = runJudge({ id: "p" }, { isPrincipal: true });
  const text = runMarkdown(
    run({ config: config({ check_eval_awareness: true }) }),
    [sample({ id: "s1", repetition: 0 }), sample({ id: "s2", repetition: 1 })],
    [principal, awake],
  );
  assert.match(text, /\*\*Eval-awareness check\*\* on/);
  // The same sentence as the on-screen indicator's (awarenessSentence): the file
  // must not tell a different story from the interface.
  assert.match(text, /1 of 2 conversations showed signs/);
});

test("the markdown summary says clearly when the awareness judge was off", () => {
  // Without this line, a run launched with the judge off reads as a perfectly
  // healthy run once exported — the misreading this project exists to avoid, here
  // transposed to the file rather than the screen.
  const text = runMarkdown(run({ config: config({ check_eval_awareness: false }) }), [sample()], []);
  assert.match(text, /\*\*Eval-awareness check\*\* off/);
});

test("nothing has been judged yet: the outcome keeps quiet rather than announcing 0 out of 0", () => {
  const awake = runJudge(
    { id: "awake", system_type: AWAKE_TYPE, criterion: null, rubric: null },
    { scores: { s: verdict({ status: "pending", score: null }) } },
  );
  const text = runMarkdown(run({ config: config({ check_eval_awareness: true }) }), [sample()], [awake]);
  assert.match(text, /\*\*Eval-awareness check\*\* on/);
  assert.doesNotMatch(text, /0 of 0/);
});

test("a run predating this field claims neither on nor off", () => {
  // `config()` does not carry `check_eval_awareness` by default — exactly the
  // state of a run recorded before this feature. Asserting "on" here (the old
  // behaviour, with `!== false`) would lie: that check never ran on this run.
  const text = runMarkdown(run(), [sample()], []);
  assert.doesNotMatch(text, /\*\*Eval-awareness check\*\* on/);
  assert.doesNotMatch(text, /\*\*Eval-awareness check\*\* off/);
  assert.match(text, /\*\*Eval-awareness check\*\* unknown/);
});
