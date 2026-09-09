// An extension's real cost is not stored, it is derived: the gap between its
// `cost_before_usd` and the next one's, or the run's current cost for the last.
// This file tests only that derivation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionsOf } from "./run-extensions.ts";
import type { EvalRun, RunExtensionLogEntry } from "./types";

/** A minimal entry, with just what `extensionsOf` looks at. The cast holds
 *  because the function reads nothing else on an entry. */
const ENTRY = (
  cost_before_usd: number | null,
  extra: Partial<RunExtensionLogEntry> = {},
): RunExtensionLogEntry =>
  ({
    at: "2026-09-05T12:00:00.000Z",
    by: "quelquun@polaris.example",
    via: "ui",
    request: { scenario_indices: [0], new_scenarios: [], targets: [], repetitions: 1 },
    estimate: null,
    cost_before_usd,
    ...extra,
  }) as unknown as RunExtensionLogEntry;

/** A run reduced to the two fields `extensionsOf` reads: `extensions` and
 *  `cost_usd`. The cast holds for the same reason as in `ENTRY`. */
const RUN = (extensions: RunExtensionLogEntry[], cost_usd: number | null): EvalRun =>
  ({ extensions, cost_usd }) as unknown as EvalRun;

test("no extension: an empty list", () => {
  assert.deepEqual(extensionsOf(RUN([], 12)), []);
});

test("one alone, run finished: its real cost is the gap with the run's cost", () => {
  const run = RUN([ENTRY(5)], 8);
  const [extension] = extensionsOf(run);
  assert.equal(extension.cost_before_usd, 5);
  assert.equal(extension.actual_cost_usd, 3);
});

test("several in a row: each is measured against the one after it", () => {
  const run = RUN([ENTRY(0), ENTRY(2), ENTRY(5)], 9);
  const [first, second, last] = extensionsOf(run);
  assert.equal(first.actual_cost_usd, 2); // 2 - 0
  assert.equal(second.actual_cost_usd, 3); // 5 - 2
  assert.equal(last.actual_cost_usd, 4); // 9 - 5
});

test("the last one when the run has no real cost yet: null, never 0", () => {
  const run = RUN([ENTRY(0), ENTRY(2)], null);
  const [first, last] = extensionsOf(run);
  // The first is measured against the next, which is known: nothing stops it.
  assert.equal(first.actual_cost_usd, 2);
  // The last would be measured against the run's current cost, which is missing.
  assert.equal(last.actual_cost_usd, null);
});

test("cost_before_usd missing on an entry: its real cost is unknown, not free", () => {
  // A run that had cost nothing yet at the time of that extension — or one of
  // whose models had no price — must never read as $0: those are two different
  // things, and confusing them would show a false figure with the same
  // assurance as a true one.
  const run = RUN([ENTRY(null), ENTRY(4)], 10);
  const [first, last] = extensionsOf(run);
  assert.equal(first.actual_cost_usd, null);
  assert.equal(last.actual_cost_usd, 6);
});

test("every entry keeps what it already carried, plus the real cost", () => {
  const entry = ENTRY(1, { by: "agent@polaris.example", via: "mcp" });
  const [extension] = extensionsOf(RUN([entry], 3));
  assert.equal(extension.by, "agent@polaris.example");
  assert.equal(extension.via, "mcp");
  assert.deepEqual(extension.request, entry.request);
});
