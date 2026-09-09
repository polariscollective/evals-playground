// The indicator of the served results, and the crossing that justifies building
// it. See docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  argumentsKey,
  awarenessJoin,
  callsMade,
  servedSentence,
  servedSummary,
  unfaithfulCalls,
  type ToolResultRow,
} from "./served.ts";

const row = (extra: Partial<ToolResultRow> = {}): ToolResultRow => ({
  scenario_index: 0,
  tool_name: "search_files",
  arguments: { query: "Vandenberghe" },
  faithful: true,
  fault: "",
  check_error: null,
  ...extra,
});

const call = (name: string, args: Record<string, unknown>) => ({
  role: "assistant",
  tool_calls: [{ name, arguments: args }],
});

// --- The three outcomes, never merged --------------------------------------

test("the indicator separates faithful, at fault, and not yet checked", () => {
  // "Not yet checked" is not "faithful": the check has not been over it, it has
  // said nothing. Confusing them would make an unverified run pass for a clean
  // one.
  const summary = servedSummary([
    row(),
    row({ faithful: false, fault: "invented a file" }),
    row({ faithful: null }),
  ]);
  assert.deepEqual(summary, {
    total: 3,
    unfaithful: 1,
    repaired: 0,
    sameFamily: 0,
    unchecked: 1,
    couldNotCheck: 0,
    lastCheckError: null,
  });
});

test("a failed check attempt is not confused with a check never attempted", () => {
  // The first knows it does not know and why; the second has said nothing at all
  // yet. Merging them would hide a dead key at the checker's end behind a silence
  // that looks like calm.
  const summary = servedSummary([
    row({ faithful: null }),
    row({ faithful: null, check_error: "AuthenticationError: invalid key" }),
    row({ faithful: null, check_error: "RateLimitError: quota exceeded" }),
  ]);
  assert.deepEqual(summary, {
    total: 3,
    unfaithful: 0,
    repaired: 0,
    sameFamily: 0,
    unchecked: 1,
    couldNotCheck: 2,
    lastCheckError: "RateLimitError: quota exceeded",
  });
});

test("a run that served nothing has no indicator", () => {
  assert.equal(servedSentence(servedSummary([]), awarenessJoin([], [])), null);
});

// --- Matching a transcript to a row ----------------------------------------

test("the order of the arguments does not separate two identical calls", () => {
  assert.equal(argumentsKey({ a: 1, b: 2 }), argumentsKey({ b: 2, a: 1 }));
});

test("the calls are read on the assistant turns, not on the tool turns", () => {
  // A `tool` turn carries only what was returned: it has no arguments, and
  // counting it would double every call.
  const seen = callsMade(0, [
    call("search_files", { query: "X" }),
    { role: "tool", tool_calls: null },
  ]);
  assert.equal(seen.size, 1);
});

test("two scenarios do not share a call", () => {
  // The world differs per scenario: the same query has not the same answer there.
  const first = callsMade(0, [call("search_files", { query: "X" })]);
  const second = callsMade(1, [call("search_files", { query: "X" })]);
  assert.notDeepEqual([...first], [...second]);
});

test("only the results judged at fault enter the set", () => {
  const atFault = unfaithfulCalls([
    row(),
    row({ faithful: null }),
    row({ arguments: { query: "X" }, faithful: false, fault: "wide of the mark" }),
  ]);
  assert.equal(atFault.size, 1);
});

// --- The crossing ----------------------------------------------------------

const AT_FAULT = row({
  arguments: { query: "X" },
  faithful: false,
  fault: "answered wide of the mark",
});

test("an awake conversation that saw a fault is matched to both", () => {
  // It is the answer to "is this model perceptive, or did we break the setting".
  // Without it, one rereads the transcripts one by one.
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [call("search_files", { query: "X" })], awake: true }],
    [AT_FAULT],
  );
  assert.deepEqual(join, { awake: 1, awakeAfterFault: 1, faultUnnoticed: 0 });
});

test("an awake conversation that saw nothing at fault stays unexplained", () => {
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [call("search_files", { query: "Z" })], awake: true }],
    [AT_FAULT],
  );
  assert.deepEqual(join, { awake: 1, awakeAfterFault: 0, faultUnnoticed: 0 });
});

test("a fault nobody noticed is counted too", () => {
  // The run is not invalidated by it, but we would rather know: we served
  // anything and the awareness judge saw nothing.
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [call("search_files", { query: "X" })], awake: false }],
    [AT_FAULT],
  );
  assert.deepEqual(join, { awake: 0, awakeAfterFault: 0, faultUnnoticed: 1 });
});

test("with no fault at all, awareness is counted all the same", () => {
  const join = awarenessJoin(
    [{ scenario_index: 0, transcript: [], awake: true }],
    [row()],
  );
  assert.equal(join.awake, 1);
  assert.equal(join.awakeAfterFault, 0);
});

// --- The sentence ----------------------------------------------------------

test("the sentence talks of faults only if there are any", () => {
  const sentence = servedSentence(servedSummary([row(), row()]), awarenessJoin([], []));
  assert.match(sentence!, /2 tool results served/);
  assert.ok(!sentence!.includes("did not hold up"));
});

test("the sentence names the crossing when it teaches something", () => {
  const samples = [
    { scenario_index: 0, transcript: [call("search_files", { query: "X" })], awake: true },
  ];
  const rows = [AT_FAULT, row()];
  const sentence = servedSentence(servedSummary(rows), awarenessJoin(samples, rows));
  assert.match(sentence!, /1 did not hold up/);
  assert.match(sentence!, /1 of the 1 conversations the awareness judge flagged saw one/);
});

test("the sentence also says the faults nobody noticed", () => {
  const samples = [
    { scenario_index: 0, transcript: [call("search_files", { query: "X" })], awake: false },
  ];
  const rows = [AT_FAULT];
  const sentence = servedSentence(servedSummary(rows), awarenessJoin(samples, rows));
  assert.match(sentence!, /without the awareness judge noticing/);
});

test("with no crossing possible, the sentence keeps quiet rather than announcing zero", () => {
  // The transcripts are loaded only on demand. "0 of the 3 awake conversations"
  // would read as "none" where the truth is "we do not know".
  const rows = [AT_FAULT];
  const sentence = servedSentence(servedSummary(rows), null);
  assert.match(sentence!, /1 did not hold up/);
  assert.ok(!sentence!.includes("awareness judge"));
});

test("the unchecked rows are said, not hidden", () => {
  const sentence = servedSentence(
    servedSummary([row(), row({ faithful: null })]),
    awarenessJoin([], []),
  );
  assert.match(sentence!, /1 not checked yet/);
});

test("the rows that could not be checked also say why", () => {
  const sentence = servedSentence(
    servedSummary([
      row(),
      row({ faithful: null, check_error: "AuthenticationError: invalid key" }),
    ]),
    awarenessJoin([], []),
  );
  assert.match(sentence!, /1 could not be checked \(AuthenticationError: invalid key\)/);
  assert.ok(!sentence!.includes("not checked yet"));
});

test("served despite a failed repair is an outcome of its own", () => {
  // The fifth, and this product never merges two. It stays a subset of
  // `unfaithful`: the same row at fault, seen closer up.
  const summary = servedSummary([
    row({ faithful: false, fault: "invented", attempts: 2 }),
    row({ faithful: false, fault: "invented" }),
  ]);
  assert.equal(summary.unfaithful, 2);
  assert.equal(summary.repaired, 1);
});

test("a checker from the server's own family is counted and said", () => {
  // The spec's fallback: better a checker with a shared bias than no check at
  // all, but that is known rather than guessed.
  const summary = servedSummary([
    row({
      model: "anthropic/claude-opus-5",
      check_model: "anthropic/claude-haiku-4-5",
    }),
    row({ model: "anthropic/claude-opus-5", check_model: "openai/gpt-5.6-luna" }),
  ]);
  assert.equal(summary.sameFamily, 1);
  assert.match(
    servedSentence(summary, null) ?? "",
    /checked by the world model's own family/,
  );
});

test("the failed repair is said inside the fault clause", () => {
  // Not in a sentence of its own: it is the same row, and announcing it apart
  // would make a quick reader count it twice.
  const sentence = servedSentence(
    servedSummary([row({ faithful: false, fault: "invented", attempts: 2 })]),
    null,
  );
  assert.match(sentence ?? "", /1 did not hold up \(1 after a failed repair\)/);
});
