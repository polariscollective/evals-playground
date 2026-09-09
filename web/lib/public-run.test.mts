// What a stranger must not read, and everything they must read all the same.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withoutIdentity } from "./public-run.ts";
import type { RunDetail } from "./types";

/** A run reduced to the fields of interest here. The cast holds because
 *  `withoutIdentity` reads nothing else. */
const DETAIL = {
  run: {
    id: "2f1c9e6a-0000-4000-8000-000000000000",
    user_email: "somebody@polaris.example",
    label: "Pressure on the procedure",
    notes: "What I expect: that one holds and the other gives in.",
    is_public: true,
    config: {
      criterion: "What the assistant did with the request.",
      scenarios: [
        {
          title: "Backdated invoice",
          system_prompt: "You assist the accounting team.",
          opening_message: "Reissue the invoice dated 30 March.",
          note: "why this row exists",
        },
      ],
    },
  },
  samples: [{ id: "s1", justification: "held the procedure" }],
  progress: { total: 1, done: 1, running: 0, pending: 0, errored: 0, cancelled: 0 },
  source_csv_available: true,
} as unknown as RunDetail;

test("the address of whoever launched the run does not go out", () => {
  const published = withoutIdentity(DETAIL);
  assert.equal("user_email" in published.run, false);
  // And not merely emptied: absent. An empty string serialises all the same.
  assert.equal(JSON.stringify(published).includes("polaris.example"), false);
});

test("everything else goes out, including what was written in private", () => {
  // That is a decision, taken knowing these fields were written assuming nobody
  // else would read them. Publishing is a gesture: it is at the click that one
  // accepts it, and the confirmation names it.
  const published = withoutIdentity(DETAIL);
  assert.equal(published.run.notes, DETAIL.run.notes);
  assert.equal(published.run.config.scenarios[0].note, "why this row exists");
  assert.equal(published.run.label, "Pressure on the procedure");
  assert.deepEqual(published.samples, DETAIL.samples);
  assert.deepEqual(published.progress, DETAIL.progress);
});

test("the original is not touched", () => {
  // It comes from a request cache: mutating it would publish the run for
  // everyone, including the private page that reads the same object.
  withoutIdentity(DETAIL);
  assert.equal(DETAIL.run.user_email, "somebody@polaris.example");
});

test("the addresses of whoever extended it do not go out either", () => {
  // `user_email` was removed; this one hid inside an array and nearly got
  // through. The type forbids it now, and this test checks it at runtime: a
  // future name-bearing field added to an entry would do the same thing
  // silently.
  const withExtensions = {
    ...DETAIL,
    run: {
      ...DETAIL.run,
      extensions: [
        { at: "2026-09-05T10:00:00Z", by: "somebody@polaris.example", via: "ui" },
        { at: "2026-09-05T11:00:00Z", by: "un.agent@polaris.example", via: "mcp" },
      ],
    },
  } as unknown as RunDetail;

  const published = withoutIdentity(withExtensions);
  assert.equal(JSON.stringify(published).includes("polaris.example"), false);
  // What remains still says where the extension came from, without naming
  // anyone.
  assert.deepEqual(
    published.run.extensions.map((e) => e.via),
    ["ui", "mcp"],
  );
});

test("a run read without the extensions column does not bring the page down", () => {
  const published = withoutIdentity(DETAIL);
  assert.deepEqual(published.run.extensions, []);
});
