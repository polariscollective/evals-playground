// The awareness indicator: what it counts, and when it keeps quiet — see
// awareness.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AWAKE_TYPE,
  AWARENESS_ALARM,
  AWARENESS_VISIBLE,
  awarenessEnabled,
  awarenessMissing,
  awarenessSentence,
  awarenessSummary,
  findAwakeJudge,
  isAwarenessFlagged,
  type JudgeVerdict,
} from "./awareness.ts";
import type { JudgeScoreStatus, JudgeSystemType } from "./types.ts";

// A row of `judge_scores`, reduced to what this module reads of it. `"done"` by
// default, like the vast majority of the cases tested here — `error` and
// `pending` are passed as explicit overrides, never guessed.
function verdict(
  score: number | null,
  status: JudgeScoreStatus = "done",
): JudgeVerdict {
  return { status, score };
}

test("counts the conversations that showed signs", () => {
  const summary = awarenessSummary([
    verdict(1),
    verdict(1),
    verdict(8),
    verdict(AWARENESS_ALARM),
  ]);
  assert.equal(summary.judged, 4);
  assert.equal(summary.flagged, 2);
  assert.equal(summary.failed, 0);
});

test("a judge that fell over is counted apart, never as a silence", () => {
  // Confusing "the judge could say nothing" with "it saw nothing" is exactly the
  // mistake the rest of the product avoids everywhere else. The
  // `judge_scores.status` status carries that distinction directly: `"error"`,
  // never a null grade with no label.
  const summary = awarenessSummary([
    verdict(1),
    verdict(null, "error"),
    verdict(null, "pending"),
  ]);
  assert.equal(summary.judged, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.flagged, 0);
});

test("nothing to say when nothing has been judged", () => {
  // A run launched with the awareness judge off, or whose row is still pending:
  // the indicator keeps quiet rather than announcing "0 out of 0", which would
  // read as a good result.
  assert.equal(awarenessSentence(awarenessSummary([verdict(null, "pending")])), null);
});

test("an empty or off-scale conversation (done, null grade) counts neither as judged nor as fallen over", () => {
  // `status: "done"` with `score: null` is the "empty conversation, or grade off
  // the scale" case of the design — distinct both from a breakdown (`"error"`)
  // and from a wait (`"pending"`), and silent like the other two as long as no
  // grade exists.
  const summary = awarenessSummary([verdict(null, "done")]);
  assert.equal(summary.judged, 0);
  assert.equal(summary.failed, 0);
  assert.equal(awarenessSentence(summary), null);
});

test("the judge fallen over on everything says failure, not silence", () => {
  // Judged at zero can mean two opposite things: nothing to measure, or the judge
  // breaking its teeth on every conversation. Confusing them would say "all is
  // well" when nothing is known — exactly the mistake `failed` exists to avoid
  // (see the test just above, at the scale of a single cell).
  const summary = awarenessSummary([verdict(null, "error"), verdict(null, "error")]);
  assert.equal(summary.judged, 0);
  assert.equal(summary.failed, 2);
  const sentence = awarenessSentence(summary);
  assert.match(sentence ?? "", /failed/);
  assert.match(sentence ?? "", /2/);
  assert.doesNotMatch(sentence ?? "", /No sign/);
});

test("the count of judges that fell over agrees its number in the singular", () => {
  // The rest of the repository agrees its sentences in number (see the awareness
  // button in app/eval/[runId]/page.tsx); this one must do the same rather than
  // writing "1 conversations".
  const summary = awarenessSummary([verdict(null, "error")]);
  const sentence = awarenessSentence(summary) ?? "";
  assert.match(sentence, /\b1 conversation\b/);
  assert.doesNotMatch(sentence, /1 conversations\b/);
});

test("the sentence says how many out of how many", () => {
  const sentence = awarenessSentence(awarenessSummary([verdict(1), verdict(9)]));
  assert.match(sentence ?? "", /1/);
  assert.match(sentence ?? "", /2/);
});

test("the middle band counts as judged but does not light the indicator", () => {
  // A conversation graded 5 falls between the two thresholds: below the alarm
  // (7), above the visibility threshold (4). The run's indicator stays neutral —
  // it is not part of `flagged`, which is exactly the boundary the review found
  // too blurred to serve as an alarm — but it must stay legible once the
  // conversation is opened (see RunRead.tsx, where it is `AWARENESS_VISIBLE` and
  // not `AWARENESS_ALARM` that decides the display).
  const summary = awarenessSummary([verdict(5)]);
  assert.equal(summary.judged, 1);
  assert.equal(summary.flagged, 0);
  assert.equal(summary.borderline, 1);
  // Always a word said about the run as soon as a conversation has been judged —
  // complete silence is reserved for "nothing has been judged at all".
  assert.match(awarenessSentence(summary) ?? "", /No sign/);
  assert.ok(5 >= AWARENESS_VISIBLE);
  assert.ok(5 < AWARENESS_ALARM);
});

test("the sentence does not contradict a conversation opened in the middle band", () => {
  // It is the flaw the review pointed out: the indicator said "none shows
  // anything" while a conversation shown on its own page already carries a
  // visible grade (>= AWARENESS_VISIBLE). The sentence must say both truths at
  // once, without contradicting itself.
  const summary = awarenessSummary([verdict(5), verdict(2)]);
  assert.equal(summary.flagged, 0);
  assert.equal(summary.borderline, 1);
  const sentence = awarenessSentence(summary) ?? "";
  assert.match(sentence, /No sign/);
  assert.match(sentence, /1 showed a weaker sign/);
});

test("the mention of the middle band also agrees its number", () => {
  const summary = awarenessSummary([verdict(5), verdict(6)]);
  assert.equal(summary.borderline, 2);
  const sentence = awarenessSentence(summary) ?? "";
  assert.match(sentence, /2 showed weaker signs/);
});

test("the alarm threshold is strictly higher than the visibility one", () => {
  // The gap between the two constants is the band in which a conversation reads
  // without setting the indicator off.
  assert.ok(AWARENESS_ALARM > AWARENESS_VISIBLE);
});

test("isAwarenessFlagged follows the alarm threshold exactly", () => {
  assert.equal(isAwarenessFlagged(verdict(AWARENESS_ALARM - 1)), false);
  assert.equal(isAwarenessFlagged(verdict(AWARENESS_ALARM)), true);
  assert.equal(isAwarenessFlagged(verdict(10)), true);
});

test("isAwarenessFlagged ignores a verdict fallen over or pending, even at a high grade", () => {
  // A verdict is only ever read by its status first: a grade planted beside an
  // "error" or "pending" status makes no sense and must never light the badge.
  assert.equal(isAwarenessFlagged({ status: "error", score: 10 }), false);
  assert.equal(isAwarenessFlagged({ status: "pending", score: 10 }), false);
});

test("counts the awareness score rows still pending", () => {
  // It is that number which decides whether the catch-up button has a reason to
  // exist. Since the rows exist in advance, it is a status to read, not a
  // computation on the transcripts.
  assert.equal(
    awarenessMissing([
      { status: "pending" },
      { status: "done" },
      { status: "pending" },
      { status: "error" },
    ]),
    2,
  );
  assert.equal(awarenessMissing([{ status: "done" }, { status: "error" }]), 0);
  assert.equal(awarenessMissing([]), 0);
});

test("an absent check_eval_awareness reads as unknown, never as on", () => {
  // The `!== false` convention, used elsewhere to decide whether the judge *must*
  // run, would read `undefined` as `true`. Here the question is "did it run?",
  // and on a run predating this field, the absence does not allow answering:
  // neither on, nor off, unknown. This test fails with a `!== false`
  // reintroduced here by mistake.
  assert.equal(awarenessEnabled(undefined), null);
  assert.equal(awarenessEnabled(true), true);
  assert.equal(awarenessEnabled(false), false);
});

// --- the awareness judge found by its type, not by its place ---------------

interface Link {
  system_type: JudgeSystemType | null;
  name: string;
}

test("findAwakeJudge finds the awake link among others", () => {
  const links: Link[] = [
    { system_type: null, name: "principal" },
    { system_type: AWAKE_TYPE, name: "awareness" },
    { system_type: null, name: "secondary" },
  ];
  assert.equal(findAwakeJudge(links)?.name, "awareness");
});

test("findAwakeJudge returns undefined when the run has no living awareness judge", () => {
  const links: Link[] = [{ system_type: null, name: "principal" }];
  assert.equal(findAwakeJudge(links), undefined);
  assert.equal(findAwakeJudge([]), undefined);
});
