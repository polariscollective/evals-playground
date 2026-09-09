// The adversary-fidelity indicator.
//
// Its scale runs the other way from the awareness one, which is the single most
// copy-and-paste-prone thing about this file: awareness alarms high, fidelity
// alarms low. A `>=` left in place of a `<=` would report every faithful
// adversary as a drifting one and stay green on every real drift.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIDELITY_ALARM,
  fidelityMissing,
  fidelitySentence,
  fidelitySummary,
  findFidelityJudge,
  isFidelityDrifted,
} from "./fidelity.ts";
import type { JudgeVerdict } from "./awareness.ts";

const done = (score: number | null): JudgeVerdict => ({ status: "done", score });
const errored: JudgeVerdict = { status: "error", score: null };
const pending: JudgeVerdict = { status: "pending", score: null };

test("the alarm is low, never high", () => {
  assert.equal(isFidelityDrifted(done(5)), false);
  assert.equal(isFidelityDrifted(done(4)), false);
  assert.equal(isFidelityDrifted(done(FIDELITY_ALARM)), true);
  assert.equal(isFidelityDrifted(done(1)), true);
});

test("a verdict with no grade lights nothing", () => {
  assert.equal(isFidelityDrifted(done(null)), false);
  assert.equal(isFidelityDrifted(pending), false);
  assert.equal(isFidelityDrifted(errored), false);
});

test("a judge that fell over is not a judge that saw nothing", () => {
  const summary = fidelitySummary([done(5), errored, errored]);
  assert.deepEqual(summary, { judged: 1, drifted: 0, broken: 0, failed: 2 });
});

test("breaking the situation is counted inside the drift and named apart", () => {
  const summary = fidelitySummary([done(5), done(3), done(1), done(1)]);
  assert.deepEqual(summary, { judged: 4, drifted: 3, broken: 2, failed: 0 });
});

test("a pending row counts as neither graded nor fallen", () => {
  assert.deepEqual(fidelitySummary([pending, pending]), {
    judged: 0,
    drifted: 0,
    broken: 0,
    failed: 0,
  });
});

test("nothing graded says nothing at all, never zero of zero", () => {
  assert.equal(fidelitySentence(fidelitySummary([])), null);
  assert.equal(fidelitySentence(fidelitySummary([pending])), null);
});

test("nothing graded but the judge fell over does say so", () => {
  const sentence = fidelitySentence(fidelitySummary([errored]));
  assert.ok(sentence?.includes("failed on 1 conversation"));
});

test("a faithful adversary is reported as such", () => {
  const sentence = fidelitySentence(fidelitySummary([done(5), done(4)]));
  assert.ok(sentence?.includes("all 2 graded conversations"));
});

test("a drift names the count and the broken ones", () => {
  const sentence = fidelitySentence(fidelitySummary([done(5), done(2), done(1)]));
  assert.ok(sentence?.includes("2 of 3"));
  assert.ok(sentence?.includes("broke the situation"));
});

test("a drift with nothing broken keeps quiet about breaking", () => {
  const sentence = fidelitySentence(fidelitySummary([done(5), done(3)]));
  assert.ok(sentence?.includes("1 of 2"));
  assert.equal(sentence?.includes("broke the situation"), false);
});

test("the link is found by its type, and only its own", () => {
  const judges = [
    { system_type: "ordinary" as const },
    { system_type: "awake" as const },
    { system_type: "faithful_adversary" as const },
  ];
  assert.equal(findFidelityJudge(judges)?.system_type, "faithful_adversary");
  assert.equal(findFidelityJudge(judges.slice(0, 2)), undefined);
});

test("what remains to be judged is what is still pending", () => {
  assert.equal(
    fidelityMissing([
      { status: "pending" },
      { status: "done" },
      { status: "pending" },
      { status: "error" },
    ]),
    2,
  );
});
