// The catch-up predicate, in isolation: see `catchup.ts`'s head comment for
// the bug it exists to stop being reproduced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catchupCandidateCount } from "./catchup.ts";

test("a pending row on a finished conversation counts", () => {
  const count = catchupCandidateCount([{ sample_id: "s1" }], new Set(["s1"]));
  assert.equal(count, 1);
});

test("a pending row on a conversation not yet finished does not count", () => {
  // Reproduces the work's original bug: a cancelled or still-running
  // conversation carries its pending score row all the same — laid down
  // d'avance, au lancement — mais le moteur ne la touchera jamais tant
  // qu'elle n'est pas `done` (voir `catchup_dataset`,
  // backend/playground/batch_job.py). Un compte qui l'ignorerait
  // would announce "1 to catch up" for a catch-up that would do 0.
  const count = catchupCandidateCount(
    [{ sample_id: "cancelled-1" }],
    new Set(), // no finished conversation
  );
  assert.equal(count, 0);
});

test("counts correctly on a mix of finished and unfinished rows", () => {
  const count = catchupCandidateCount(
    [{ sample_id: "a" }, { sample_id: "b" }, { sample_id: "c" }],
    new Set(["a", "c"]),
  );
  assert.equal(count, 2);
});

test("no pending row: nothing to catch up", () => {
  assert.equal(catchupCandidateCount([], new Set(["a"])), 0);
});
