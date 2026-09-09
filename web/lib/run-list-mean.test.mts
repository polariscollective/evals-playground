// The mean drawn from the histogram the view returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { meanFromHistogram } from "./run-list-mean.ts";

test("aucun histogramme : aucune moyenne", () => {
  // Distinct from an empty histogram: nobody has graded yet.
  assert.equal(meanFromHistogram(null, []), null);
});

test("the mean weights by how many times a grade came up", () => {
  // 0 trois fois, 2 cinq fois → (0×3 + 2×5) / 8
  assert.equal(meanFromHistogram({ "0": 3, "2": 5 }, []), 10 / 8);
});

test("Postgres float keys can be read", () => {
  // `jsonb_object_agg` sur un `double precision` rend « 0.0 », pas « 0 ».
  assert.equal(meanFromHistogram({ "0.0": 2, "1.0": 2 }, []), 0.5);
});

test("an excluded level leaves the mean, it does not count as zero", () => {
  // C'est toute la raison pour laquelle le calcul n'est pas en SQL.
  const rubric = [
    { value: 0, meaning: "non" },
    { value: 2, meaning: "oui" },
    { value: 9, meaning: "sans objet", excluded: true },
  ];
  assert.equal(meanFromHistogram({ "0": 1, "2": 1, "9": 10 }, rubric), 1);
});

test("everything excluded: no mean, and not zero", () => {
  const rubric = [{ value: 9, meaning: "sans objet", excluded: true }];
  assert.equal(meanFromHistogram({ "9": 4 }, rubric), null);
});

test("an unreadable key is ignored rather than producing NaN", () => {
  assert.equal(meanFromHistogram({ "2": 1, "n'importe quoi": 5 }, []), 2);
});
