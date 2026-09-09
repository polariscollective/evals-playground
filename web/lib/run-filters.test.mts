// The filter of both lists: which side a row falls on, what the bar offers, and
// what stays displayed.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIMENSIONS,
  OPEN,
  PSEUDO_TAG_CLASSES,
  STATUS_TAGS,
  choiceOf,
  cycleDimension,
  draftSides,
  isReservedTag,
  matchesQuery,
  nextChoice,
  offered,
  passes,
  runSides,
  sameFilter,
  sideLabel,
  toggleOff,
} from "./run-filters.ts";
import type { FilterableDraft, FilterableRun } from "./run-filters.ts";

const run = (over: Partial<FilterableRun> = {}): FilterableRun => ({
  status: "done",
  origin: "cloud-run",
  is_public: false,
  launched_via: "ui",
  ...over,
});

const draft = (over: Partial<FilterableDraft> = {}): FilterableDraft => ({
  kind: "run",
  launched_at: null,
  origin: "manual",
  ...over,
});

// --- which side a row falls on --------------------------------------------

test("an ordinary run falls on the plain side of every dimension", () => {
  assert.deepEqual(runSides(run()), {
    machine: "b",
    visibility: "b",
    author: "b",
  });
});

test("each notable property tips its dimension", () => {
  assert.equal(runSides(run({ origin: "local" })).machine, "a");
  assert.equal(runSides(run({ is_public: true })).visibility, "a");
  assert.equal(runSides(run({ launched_via: "mcp" })).author, "a");
});

test("a draft has neither machine nor publication", () => {
  const sides = draftSides(draft());
  assert.equal(sides.machine, undefined);
  assert.equal(sides.visibility, undefined);
  assert.deepEqual(sides, { author: "b", kind: "b", launch: "b" });
});

test("the three dimensions of a draft tip over", () => {
  assert.equal(draftSides(draft({ origin: "mcp" })).author, "a");
  assert.equal(draftSides(draft({ kind: "extend" })).kind, "a");
  assert.equal(draftSides(draft({ launched_at: "2026-09-07" })).launch, "a");
});

test("each side has its word", () => {
  assert.equal(sideLabel("machine", "a"), "local");
  assert.equal(sideLabel("machine", "b"), "live");
  assert.equal(sideLabel("author", "a"), "mcp");
  assert.equal(sideLabel("author", "b"), "manual");
});

// --- a button's cycle -----------------------------------------------------

test("a button cycles: both, the notable side, the other, both", () => {
  // `a` first: one clicks "MCP" to SEE the agent runs.
  assert.equal(nextChoice("both"), "a");
  assert.equal(nextChoice("a"), "b");
  assert.equal(nextChoice("b"), "both");
});

test("the full cycle comes back to the open state, leaving nothing behind", () => {
  let state = OPEN;
  state = cycleDimension(state, "author");
  assert.equal(choiceOf(state, "author"), "a");
  state = cycleDimension(state, "author");
  assert.equal(choiceOf(state, "author"), "b");
  state = cycleDimension(state, "author");
  assert.equal(choiceOf(state, "author"), "both");
  // "both" is not written: the absence says it, and that is what makes a
  // dimension added tomorrow born open.
  assert.deepEqual(state.dims, {});
});

test("narrowing one dimension touches no other", () => {
  const state = cycleDimension(cycleDimension(OPEN, "author"), "machine");
  assert.equal(choiceOf(state, "author"), "a");
  assert.equal(choiceOf(state, "machine"), "a");
});

// --- what passes ----------------------------------------------------------

test("nothing narrowed, nothing turned off: everything passes", () => {
  assert.equal(passes(runSides(run()), ["done", "budget"], OPEN), true);
});

test("narrowing to the notable side keeps it alone", () => {
  const state = cycleDimension(OPEN, "author");
  assert.equal(passes(runSides(run({ launched_via: "mcp" })), [], state), true);
  assert.equal(passes(runSides(run({ launched_via: "ui" })), [], state), false);
});

test("narrowing to the other side does exactly the reverse", () => {
  // It is what the old binary model could not do: "I want ONLY the agent runs"
  // had no button.
  const state = cycleDimension(cycleDimension(OPEN, "author"), "author");
  assert.equal(passes(runSides(run({ launched_via: "mcp" })), [], state), false);
  assert.equal(passes(runSides(run({ launched_via: "ui" })), [], state), true);
});

test("two narrowed dimensions add up", () => {
  let state = cycleDimension(OPEN, "author");
  state = cycleDimension(state, "machine");
  assert.equal(
    passes(runSides(run({ launched_via: "mcp", origin: "local" })), [], state),
    true,
  );
  assert.equal(
    passes(
      runSides(run({ launched_via: "mcp", origin: "cloud-run" })),
      [],
      state,
    ),
    false,
  );
});

test("a dimension the row does not know does not set it aside", () => {
  // A draft has no machine: the runs filter must not erase it.
  const state = cycleDimension(OPEN, "machine");
  assert.equal(passes(draftSides(draft()), [], state), true);
});

test("a tag turned off sets aside the rows carrying it, and them alone", () => {
  const state = toggleOff(OPEN, "budget");
  assert.equal(passes({}, ["budget", "test"], state), false);
  assert.equal(passes({}, ["test"], state), true);
  // A row with no tag carries nothing anyone has turned off.
  assert.equal(passes({}, [], state), true);
});

test("turning off then back on leaves no trace", () => {
  const state = toggleOff(toggleOff(OPEN, "budget"), "budget");
  assert.deepEqual(state.off, []);
});

// --- what the bar offers --------------------------------------------------

test("the bar offers a dimension only if its notable side exists", () => {
  const rows = [
    { sides: runSides(run({ origin: "local" })), labels: ["done"] },
    { sides: runSides(run()), labels: ["done", "budget"] },
  ];
  const bar = offered("runs", rows);
  // "machine": one run is local. "visibility" and "author": nobody is published
  // or launched by an agent, so no button.
  assert.deepEqual(bar.dims, ["machine"]);
  assert.deepEqual(bar.statuses, ["done"]);
  assert.deepEqual(bar.tags, ["budget"]);
});

test("each list sees only the dimensions that concern it", () => {
  const drafts = [
    { sides: draftSides(draft({ origin: "mcp", kind: "extend" })), labels: [] },
    { sides: draftSides(draft({ launched_at: "2026-09-07" })), labels: [] },
  ];
  // Neither machine nor publication: they make no sense on a draft.
  assert.deepEqual(offered("drafts", drafts).dims, ["author", "kind", "launch"]);
  // And conversely: "kind" and "launch" have no business on the runs.
  const runs = [{ sides: runSides(run({ launched_via: "mcp" })), labels: [] }];
  assert.deepEqual(offered("runs", runs).dims, ["author"]);
});

test("the statuses keep their order, the tags are sorted and deduplicated", () => {
  const bar = offered("runs", [
    { sides: {}, labels: ["error", "zebra"] },
    { sides: {}, labels: ["done", "alpha", "zebra"] },
  ]);
  assert.deepEqual(bar.statuses, ["done", "error"]);
  assert.deepEqual(bar.tags, ["alpha", "zebra"]);
});

// --- reservation and colours ----------------------------------------------

test("both sides of every dimension are reserved, and so are the statuses", () => {
  const reserved = [
    "local", "live", "public", "private", "mcp", "MCP", "manual",
    "extend", "creation", "launched", "waiting", "done", "ERROR", " Running ",
  ];
  for (const label of reserved) {
    assert.equal(isReservedTag(label), true, label);
  }
  for (const label of ["locale", "publication", "mcp-test", "test", "done-ish"]) {
    assert.equal(isReservedTag(label), false, label);
  }
});

test("every displayable word has its classes", () => {
  // The bar and the row's badge read this same table: it is what stops them
  // diverging.
  const words = [
    ...STATUS_TAGS,
    ...Object.values(DIMENSIONS).flatMap((d) => [d.a, d.b]),
  ];
  for (const word of words) {
    assert.ok(PSEUDO_TAG_CLASSES[word]?.length > 0, word);
  }
  assert.equal(Object.keys(PSEUDO_TAG_CLASSES).length, words.length);
});

// --- "am I already there?", which decides whether a link goes dark ---------

test("two identical filters recognise each other, whatever the order", () => {
  // Compared field by field, not by serialisation: the order of an object's keys
  // and that of an array are not guaranteed, and two equal filters written in a
  // different order would have called themselves different — the link would have
  // stayed active while promising a gesture with no effect.
  const a = { dims: { author: "a" as const }, off: ["x", "y"] };
  const b = { dims: { author: "a" as const }, off: ["y", "x"] };
  assert.equal(sameFilter(a, b), true);
});

test("one narrowed dimension, or one more tag, is enough to tell them apart", () => {
  assert.equal(sameFilter(OPEN, { dims: { author: "a" }, off: [] }), false);
  assert.equal(sameFilter(OPEN, { dims: {}, off: ["budget"] }), false);
  assert.equal(sameFilter(OPEN, { dims: {}, off: [] }), true);
});

// --- the search ------------------------------------------------------------

test("an empty search lets everything through", () => {
  assert.equal(matchesQuery(["anything at all"], ""), true);
  assert.equal(matchesQuery([null], "   "), true);
});

test("it ignores case", () => {
  assert.equal(matchesQuery(["Task 17 live check"], "TASK"), true);
  assert.equal(matchesQuery(["Task 17 live check"], "live"), true);
});

test("it ignores accents, in both directions", () => {
  // Nobody should have to compose an accent to find their run again.
  assert.equal(matchesQuery(["régression"], "regression"), true);
  assert.equal(matchesQuery(["regression"], "régression"), true);
});

test("it searches in the identifier, not only in the name", () => {
  // It is what an agent returns and what one pastes from a log.
  assert.equal(
    matchesQuery(["a title", "b7d288d8-eef2-4bdb-b432-9a611b1b11d0"], "b7d288d8"),
    true,
  );
});

test("an absent name does not bring the search down", () => {
  assert.equal(matchesQuery([null, "abc"], "abc"), true);
  assert.equal(matchesQuery([null, "abc"], "zzz"), false);
});
