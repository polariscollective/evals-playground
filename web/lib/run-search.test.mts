// What `searchRuns` must guarantee: the filtering — query, status, limit — on
// what `loadRuns` has already brought back, without ever letting an agent's
// query reach a `RegExp` constructor, and a snippet that shows the real context
// around the first occurrence found.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countMatches, searchRuns, type RunTags } from "./run-search.ts";
import type { RunSummary, Tag } from "./types";

/** A minimal `RunSummary`, with only what `searchRuns` looks at. The cast holds
 *  because `searchRuns` reads nothing else — same pattern as
 *  `public-run.test.mts`. */
function runSummary(fields: {
  id: string;
  created_at: string;
  label?: string | null;
  notes?: string;
  analysis?: string;
  criterion?: string;
  status?: string;
  mean?: number | null;
  cost_usd?: number | null;
  total_samples?: number;
  targets?: string[];
  scenarios?: unknown[];
}): RunSummary {
  return {
    run: {
      id: fields.id,
      created_at: fields.created_at,
      finished_at: null,
      label: fields.label ?? null,
      status: fields.status ?? "done",
      notes: fields.notes ?? "",
      analysis: fields.analysis ?? "",
      total_samples: fields.total_samples ?? 12,
      cost_usd: fields.cost_usd ?? 0.5,
      config: {
        criterion: fields.criterion ?? "",
        scenarios: fields.scenarios ?? [{ title: "one" }, { title: "two" }],
        models: { targets: fields.targets ?? ["anthropic/claude-sonnet-5"] },
      },
    },
    mean: fields.mean ?? null,
  } as unknown as RunSummary;
}

/** A `RunTags` built from `{ id: [labels] }` — one `Tag` per label, the
 *  identifier and the colour mattering to no test here. */
function tagsMap(entries: Record<string, string[]>): RunTags {
  const map: RunTags = new Map();
  let nextId = 1;
  for (const [runId, labels] of Object.entries(entries)) {
    const tags: Tag[] = labels.map((label) => ({ id: nextId++, label, color: "#000000" }));
    map.set(runId, tags);
  }
  return map;
}

test("with no query, the `limit` most recent runs, in input order", () => {
  const runs = Array.from({ length: 12 }, (_, i) =>
    runSummary({ id: `r${i}`, created_at: `2026-09-${12 - i}` }),
  );
  const hits = searchRuns(runs, {});
  assert.equal(hits.length, 10);
  assert.deepEqual(
    hits.map((h) => h.id),
    runs.slice(0, 10).map((r) => r.run.id),
  );
});

test("with no query, `limit` chooses how many", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
    runSummary({ id: "c", created_at: "2026-09-01" }),
  ];
  const hits = searchRuns(runs, { limit: 2 });
  assert.deepEqual(hits.map((h) => h.id), ["a", "b"]);
});

test("the record carries the whole expected shape", () => {
  const runs = [
    runSummary({
      id: "a",
      created_at: "2026-09-03",
      label: "Pressure on the procedure",
      status: "done",
      mean: 0.6,
      cost_usd: 1.23,
      total_samples: 30,
      targets: ["anthropic/claude-sonnet-5", "openai/gpt-5.6-terra"],
      scenarios: [{ title: "one" }, { title: "two" }, { title: "three" }],
    }),
  ];
  const [hit] = searchRuns(runs, {});
  assert.deepEqual(hit, {
    id: "a",
    label: "Pressure on the procedure",
    status: "done",
    created_at: "2026-09-03",
    finished_at: null,
    targets: ["anthropic/claude-sonnet-5", "openai/gpt-5.6-terra"],
    scenario_count: 3,
    total_samples: 30,
    mean: 0.6,
    cost_usd: 1.23,
    tags: [],
  });
});

test("`limit` is clamped to a minimum of 1", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
  ];
  assert.equal(searchRuns(runs, { limit: 0 }).length, 1);
  assert.equal(searchRuns(runs, { limit: -5 }).length, 1);
});

test("`limit` is clamped to a maximum of 50", () => {
  const runs = Array.from({ length: 60 }, (_, i) =>
    runSummary({ id: `r${i}`, created_at: `2026-08-${(i % 28) + 1}` }),
  );
  assert.equal(searchRuns(runs, { limit: 1000 }).length, 50);
});

test("the query matches in `label`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", label: "Pressure on the procedure" })];
  const hits = searchRuns(runs, { query: "procedure" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["label"]);
});

test("the query matches in `notes`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: "The judge gave way faster than expected." })];
  const hits = searchRuns(runs, { query: "gave way" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["notes"]);
});

test("the query matches in `analysis`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", analysis: "Nothing tells the two models apart." })];
  const hits = searchRuns(runs, { query: "apart" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["analysis"]);
});

test("the query matches in `config.criterion`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", criterion: "What the assistant made of the request." })];
  const hits = searchRuns(runs, { query: "request" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["criterion"]);
});

test("the runs that do not match are set aside, the input order is kept", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-04", notes: "unrelated" }),
    runSummary({ id: "b", created_at: "2026-09-03", notes: "carries the word spring somewhere" }),
    runSummary({ id: "c", created_at: "2026-09-02", label: "spring as well" }),
    runSummary({ id: "d", created_at: "2026-09-01", notes: "still unrelated" }),
  ];
  const hits = searchRuns(runs, { query: "spring" });
  assert.deepEqual(hits.map((h) => h.id), ["b", "c"]);
});

test("the filtering is case-insensitive", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: "The SPRING gave way." })];
  assert.deepEqual(searchRuns(runs, { query: "spring" }).map((h) => h.id), ["a"]);
  assert.deepEqual(searchRuns(runs, { query: "SpRiNg" }).map((h) => h.id), ["a"]);
});

test("a query with regular-expression metacharacters is taken literally", () => {
  const runs = [
    runSummary({ id: "literal", created_at: "2026-09-03", notes: "a trial that gives a(b as a result" }),
    runSummary({ id: "no-parenthesis", created_at: "2026-09-02", notes: "a trial that gives ab as a result" }),
  ];
  // `new RegExp("a(b")` would raise — unclosed group. That must not happen.
  assert.doesNotThrow(() => searchRuns(runs, { query: "a(b" }));
  const hits = searchRuns(runs, { query: "a(b" });
  assert.deepEqual(hits.map((h) => h.id), ["literal"]);
});

test("`.*` does not play the wildcard: it matches only its own substring", () => {
  const runs = [
    runSummary({ id: "carries-the-pattern", created_at: "2026-09-03", notes: "the note says .* literally" }),
    runSummary({ id: "other-text", created_at: "2026-09-02", notes: "some text or other, long enough to match any wildcard" }),
  ];
  const hits = searchRuns(runs, { query: ".*" });
  assert.deepEqual(hits.map((h) => h.id), ["carries-the-pattern"]);
});

test("`status` filters, with no query", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", status: "done" }),
    runSummary({ id: "b", created_at: "2026-09-02", status: "error" }),
    runSummary({ id: "c", created_at: "2026-09-01", status: "error" }),
  ];
  const hits = searchRuns(runs, { status: "error" });
  assert.deepEqual(hits.map((h) => h.id), ["b", "c"]);
});

test("`status` also filters with a query, on strict equality", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", status: "done", notes: "carries the target word" }),
    runSummary({ id: "b", created_at: "2026-09-02", status: "error", notes: "carries the target word" }),
  ];
  const hits = searchRuns(runs, { query: "target", status: "error" });
  assert.deepEqual(hits.map((h) => h.id), ["b"]);
});

test("no match returns an empty list, not an error", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: "nothing in particular" })];
  assert.deepEqual(searchRuns(runs, { query: "nowhere" }), []);
});

test("the snippet shows the context around the first occurrence, cut at both ends", () => {
  const text = "x".repeat(200) + "NEEDLE" + "y".repeat(200);
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: text })];
  const [hit] = searchRuns(runs, { query: "NEEDLE" });
  const expected = `…${"x".repeat(80)}NEEDLE${"y".repeat(120)}…`;
  assert.equal(hit.snippet, expected);
  assert.ok(hit.snippet!.startsWith("…"));
  assert.ok(hit.snippet!.endsWith("…"));
  assert.ok(hit.snippet!.length <= 250);
});

test("the snippet is not cut when the occurrence is already near the edges", () => {
  const text = "The judge gave way faster than expected.";
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: text })];
  const [hit] = searchRuns(runs, { query: "gave way" });
  assert.equal(hit.snippet, text);
});

test("runs of spaces and newlines are reduced to a single space", () => {
  const text = "before\n\n   the  target   \t after";
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: text })];
  const [hit] = searchRuns(runs, { query: "target" });
  assert.equal(hit.snippet, "before the target after");
});

test("`matched_in` lists every field that matches, not only the snippet's", () => {
  const runs = [
    runSummary({
      id: "a",
      created_at: "2026-09-03",
      label: "quarterly audit",
      notes: "an audit that went wrong",
      analysis: "unrelated",
      criterion: "unrelated too",
    }),
  ];
  const [hit] = searchRuns(runs, { query: "audit" });
  assert.deepEqual(hit.matched_in, ["label", "notes"]);
});

test("`countMatches` counts every matching run, not only those `limit` lets through", () => {
  const runs = Array.from({ length: 60 }, (_, i) =>
    runSummary({ id: `r${i}`, created_at: `2026-08-${(i % 28) + 1}`, notes: "carries the target" }),
  );
  assert.equal(countMatches(runs, { query: "target" }), 60);
  assert.equal(searchRuns(runs, { query: "target", limit: 1000 }).length, 50);
});

test("`countMatches` respects `status` and is zero with no match", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", status: "done", notes: "carries the target" }),
    runSummary({ id: "b", created_at: "2026-09-02", status: "error", notes: "carries the target" }),
  ];
  assert.equal(countMatches(runs, { query: "target" }), 2);
  assert.equal(countMatches(runs, { query: "target", status: "error" }), 1);
  assert.equal(countMatches(runs, { query: "nowhere" }), 0);
});

test("a run's tag labels come up in its record, in the order `tagsByRun` carries", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
  ];
  const tags = tagsMap({ a: ["urgent", "api"] });
  const hits = searchRuns(runs, {}, tags);
  assert.deepEqual(hits.find((h) => h.id === "a")!.tags, ["urgent", "api"]);
  assert.deepEqual(hits.find((h) => h.id === "b")!.tags, []);
});

test("`tag` keeps only the runs that carry that label", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
    runSummary({ id: "c", created_at: "2026-09-01" }),
  ];
  const tags = tagsMap({ a: ["api"], b: ["frontend"], c: ["api", "urgent"] });
  const hits = searchRuns(runs, { tag: "api" }, tags);
  assert.deepEqual(hits.map((h) => h.id), ["a", "c"]);
});

test("`tag` is case-insensitive", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03" })];
  const tags = tagsMap({ a: ["API"] });
  assert.deepEqual(searchRuns(runs, { tag: "api" }, tags).map((h) => h.id), ["a"]);
  assert.deepEqual(searchRuns(runs, { tag: "ApI" }, tags).map((h) => h.id), ["a"]);
});

test("`tag` matches the whole label, not a substring: `api` does not bring up a `rapid` tag", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
  ];
  const tags = tagsMap({ a: ["api"], b: ["rapid"] });
  assert.deepEqual(searchRuns(runs, { tag: "api" }, tags).map((h) => h.id), ["a"]);
});

test("`tag` combines with `query`", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", notes: "carries the target" }),
    runSummary({ id: "b", created_at: "2026-09-02", notes: "carries the target" }),
    runSummary({ id: "c", created_at: "2026-09-01", notes: "unrelated" }),
  ];
  const tags = tagsMap({ a: ["api"], b: ["frontend"], c: ["api"] });
  const hits = searchRuns(runs, { query: "target", tag: "api" }, tags);
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
});

test("`tag` combines with `status`", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", status: "done" }),
    runSummary({ id: "b", created_at: "2026-09-02", status: "error" }),
    runSummary({ id: "c", created_at: "2026-09-01", status: "error" }),
  ];
  const tags = tagsMap({ a: ["api"], b: ["api"], c: ["frontend"] });
  const hits = searchRuns(runs, { status: "error", tag: "api" }, tags);
  assert.deepEqual(hits.map((h) => h.id), ["b"]);
});

test("an unknown tag returns an empty list, not an error", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03" })];
  const tags = tagsMap({ a: ["api"] });
  assert.deepEqual(searchRuns(runs, { tag: "nowhere" }, tags), []);
  assert.equal(countMatches(runs, { tag: "nowhere" }, tags), 0);
});

test("`countMatches` respects `tag`", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
  ];
  const tags = tagsMap({ a: ["api"], b: ["frontend"] });
  assert.equal(countMatches(runs, { tag: "api" }, tags), 1);
});

test("the snippet comes from the first matching field, in the order label then criterion then notes then analysis", () => {
  const runs = [
    runSummary({
      id: "a",
      created_at: "2026-09-03",
      label: "unrelated",
      criterion: "the searched word is here, in the criterion",
      notes: "the searched word is also here, in the notes",
    }),
  ];
  const [hit] = searchRuns(runs, { query: "searched" });
  assert.deepEqual(hit.matched_in, ["criterion", "notes"]);
  assert.ok(hit.snippet!.includes("criterion"));
  assert.ok(!hit.snippet!.includes("notes"));
});
