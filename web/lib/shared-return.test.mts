// Where a shared page sends somebody who signs in from it.
//
// The rule that matters: the destination is the INTERNAL page, never the shared
// one. Coming back to `/shared/…` after signing in would land the visitor on
// the same read-only copy, having gained nothing for the trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { adviceReturn, runReturn, sharedAdviceFor } from "./shared-return.ts";

test("a shared run comes back as the run itself", () => {
  assert.equal(
    runReturn("1a598681-b251-4a35-b87c-15f4c732f8ab"),
    "/eval/1a598681-b251-4a35-b87c-15f4c732f8ab",
  );
});

test("the destination is never under /shared", () => {
  assert.doesNotMatch(runReturn("abc"), /shared/);
  assert.doesNotMatch(adviceReturn("judge"), /shared/);
});

test("the document being read travels", () => {
  // Somebody signing in from the judge document comes back to the judge
  // document, not to the first tab.
  assert.equal(adviceReturn("judge"), "/advice?topic=judge");
  assert.equal(adviceReturn("analysis"), "/advice?topic=analysis");
});

test("the default tab is not written into the address", () => {
  // `scenario` is what opens when nothing is asked for, on both sides. Carrying
  // it would put the default in the address bar and say nothing more.
  assert.equal(adviceReturn("scenario"), "/advice");
  assert.equal(adviceReturn(""), "/advice");
});

// --- the other direction ------------------------------------------------------
//
// Somebody who opens `/advice` with no session is bounced to the door for
// something that was never locked. This is the way back out.

test("the door offers the public copy of the advice", () => {
  assert.equal(sharedAdviceFor(undefined), "/shared/advice");
  assert.equal(sharedAdviceFor("/advice"), "/shared/advice");
});

test("the document they were heading for travels with them", () => {
  assert.equal(sharedAdviceFor("/advice?topic=judge"), "/shared/advice?topic=judge");
});

test("a callback that is not the advice lands on the top of it", () => {
  // A run has a public twin only when it was published. Sending a stranger to a
  // 404 would be worse than sending them to the first document.
  assert.equal(sharedAdviceFor("/eval/abc"), "/shared/advice");
  assert.equal(sharedAdviceFor("/runs"), "/shared/advice");
  assert.equal(sharedAdviceFor("/"), "/shared/advice");
});

test("only a plain word travels into the address this builds", () => {
  assert.equal(sharedAdviceFor("/advice?topic=../../etc"), "/shared/advice");
  assert.equal(sharedAdviceFor("/advice?topic="), "/shared/advice");
  assert.equal(
    sharedAdviceFor("/advice?topic=judge&other=1"),
    "/shared/advice?topic=judge",
  );
});
