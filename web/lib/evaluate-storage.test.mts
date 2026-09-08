// What comes back from localStorage was written by an older version of this
// app, or edited by hand in devtools. `parseSaved` is the only thing standing
// between that and a form that renders — so it is the part worth testing, and
// the reason reading is split from the storage access at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSaved } from "./evaluate-storage.ts";
import type { EvalRunConfig } from "./types.ts";

const CONFIG = {
  scenarios: [{ title: "T", system_prompt: "S", opening_message: "O" }],
  criterion: "Did it delete?",
  rubric: [
    { value: 0, meaning: "no" },
    { value: 1, meaning: "yes" },
  ],
  turns: 1,
  repetitions: 5,
  models: { targets: ["anthropic/claude-sonnet-5"], judge: "anthropic/claude-opus-5" },
  adversary_prompt: "",
  notes: "",
} as unknown as EvalRunConfig;

const WRITTEN = {
  config: CONFIG,
  label: "Procedure pressure",
  csvText: "title,system_prompt\na,b\n",
  attached: { kind: "draft", id: "d-1", mine: true },
  wantedColumns: { title: "t", system: "s", opening: "o" },
};

test("reads back a form it wrote", () => {
  const saved = parseSaved(JSON.parse(JSON.stringify(WRITTEN)));
  assert.deepEqual(saved, WRITTEN);
});

test("a relaunch attachment keeps the note that explains its banner", () => {
  const saved = parseSaved({
    ...WRITTEN,
    attached: { kind: "relaunch", runId: "r-1", note: "The original CSV was not kept." },
  });
  assert.deepEqual(saved?.attached, {
    kind: "relaunch",
    runId: "r-1",
    note: "The original CSV was not kept.",
  });
});

test("refuses anything that is not a form", () => {
  for (const raw of [null, undefined, 3, "a form", [], {}, { config: "not an object" }]) {
    assert.equal(parseSaved(raw), null, JSON.stringify(raw) ?? "undefined");
  }
});

// An attachment that cannot be read must not cost the form: the fields are
// what took twenty minutes to write, the attachment only says where to save
// them back. Losing the second is a new draft; losing the first is the bug
// this whole thing exists to fix.
test("an attachment it cannot read is dropped, the form is not", () => {
  for (const attached of [
    { kind: "extend", id: "d-1" },
    { kind: "draft" },
    { kind: "relaunch", runId: 7 },
    "draft d-1",
    null,
  ]) {
    const saved = parseSaved({ ...WRITTEN, attached });
    assert.equal(saved?.attached, null, JSON.stringify(attached));
    assert.equal(saved?.label, "Procedure pressure");
  }
});

test("fields of the wrong type fall back instead of taking the form down", () => {
  const saved = parseSaved({
    config: CONFIG,
    label: 42,
    csvText: 42,
    wantedColumns: { title: "t" },
  });
  assert.equal(saved?.label, "");
  assert.equal(saved?.csvText, null);
  assert.equal(saved?.wantedColumns, null);
  assert.deepEqual(saved?.config, CONFIG);
});
