// The mean drawn from the histogram the view returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meanFromHistogram } from "./run-list-mean.ts";

test("no histogram: no mean", () => {
  // Distinct from an empty histogram: nobody has graded yet.
  assert.equal(meanFromHistogram(null, []), null);
});

test("the mean weights by how many times a grade came up", () => {
  // 0 three times, 2 five times → (0×3 + 2×5) / 8
  assert.equal(meanFromHistogram({ "0": 3, "2": 5 }, []), 10 / 8);
});

test("Postgres float keys can be read", () => {
  // `jsonb_object_agg` on a `double precision` returns "0.0", not "0".
  assert.equal(meanFromHistogram({ "0.0": 2, "1.0": 2 }, []), 0.5);
});

test("an excluded level leaves the mean, it does not count as zero", () => {
  // That is the whole reason the computation is not in SQL.
  const rubric = [
    { value: 0, meaning: "no" },
    { value: 2, meaning: "yes" },
    { value: 9, meaning: "not applicable", excluded: true },
  ];
  assert.equal(meanFromHistogram({ "0": 1, "2": 1, "9": 10 }, rubric), 1);
});

test("everything excluded: no mean, and not zero", () => {
  const rubric = [{ value: 9, meaning: "not applicable", excluded: true }];
  assert.equal(meanFromHistogram({ "9": 4 }, rubric), null);
});

test("an unreadable key is ignored rather than producing NaN", () => {
  assert.equal(meanFromHistogram({ "2": 1, "anything at all": 5 }, []), 2);
});
