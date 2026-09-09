// What a draft row shows, and where its rocket leads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftDestination, draftShape } from "./draft-row.ts";
import type { Draft } from "./types.ts";

const base = {
  id: "d1",
  csv_text: null,
  created_by: "moi@example.org",
  created_at: "2026-09-07T10:00:00Z",
  origin: "mcp" as const,
  deleted_at: null,
  launched_at: null,
  launched_run_id: null,
};

const runDraft = (over: object = {}): Draft =>
  ({
    ...base,
    kind: "run",
    extends_run_id: null,
    config: { scenarios: [{}, {}], models: { targets: ["m"] }, repetitions: 3 },
    ...over,
  }) as unknown as Draft;

const extendDraft = (over: object = {}): Draft =>
  ({
    ...base,
    kind: "extend",
    extends_run_id: "r1",
    config: { scenario_indices: [0, 1], new_scenarios: [], targets: ["m"], repetitions: 1 },
    ...over,
  }) as unknown as Draft;

test("a run draft's shape reads scenarios × models × repetitions", () => {
  assert.equal(draftShape(runDraft()), "2 × 1 × 3");
});

test("an incomplete draft shows zeros rather than falling over", () => {
  assert.equal(draftShape(runDraft({ config: {} })), "0 × 0 × 0");
});

test("an extension shows what it ADDS, marked with a plus", () => {
  // Without the "+", one would read the run's final size, which we do not have here.
  assert.equal(draftShape(extendDraft()), "+2 × 1 × 1");
});

test("a run draft's rocket leads to the pre-filled form", () => {
  assert.equal(draftDestination(runDraft()), "/?draft=d1");
});

test("an extension's leads to its run's page, panel open", () => {
  // An extension is not launched from the form: it is added to a run, and it is
  // on that run that it reads back.
  assert.equal(draftDestination(extendDraft()), "/eval/r1?extend=d1");
});

test("a draft already launched leads to the run it produced", () => {
  assert.equal(
    draftDestination(runDraft({ launched_at: "2026-09-07", launched_run_id: "r9" })),
    "/eval/r9",
  );
  assert.equal(
    draftDestination(extendDraft({ launched_at: "2026-09-07", launched_run_id: "r9" })),
    "/eval/r9",
  );
});

test("an extension already applied leads to the run's history, not its panel", () => {
  // Reapplying is not idempotent: the repetitions stack. A launched extension
  // is therefore a trace, no longer a proposal to reopen — and
  // `launched_run_id` is never written, so `launched_at` is the only witness
  // that it was used.
  assert.equal(
    draftDestination(extendDraft({ launched_at: "2026-09-06T16:33:42.873Z" })),
    "/eval/r1#extensions",
  );
});

test("a pending extension still leads to its panel", () => {
  // Duplicates the assertion of the test above deliberately: this is the case
  // that must not move, the one adding the banner (task "an extension already
  // applied") had no right to break.
  assert.equal(draftDestination(extendDraft()), "/eval/r1?extend=d1");
});
