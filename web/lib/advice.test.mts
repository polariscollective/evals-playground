import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADVICE_SUMMARY,
  ADVICE_TOPICS,
  DEFAULT_ADVICE,
  adviceFor,
  isAdviceTopic,
  overridesOf,
} from "./advice.ts";

test("an absent override falls back to the default", () => {
  assert.equal(adviceFor("analysis", null), DEFAULT_ADVICE.analysis);
  assert.equal(adviceFor("analysis", undefined), DEFAULT_ADVICE.analysis);
  assert.equal(adviceFor("analysis", {}), DEFAULT_ADVICE.analysis);
});

// Emptying the field on screen means "put the default back", never "send my
// agent nothing any more".
test("a blank override falls back rather than serving nothing", () => {
  assert.equal(adviceFor("judge", { judge: "   " }), DEFAULT_ADVICE.judge);
  assert.equal(adviceFor("judge", { judge: "" }), DEFAULT_ADVICE.judge);
});

test("an override on one topic leaves the others alone", () => {
  const overrides = { scenario: "mine" };
  assert.equal(adviceFor("scenario", overrides), "mine");
  assert.equal(adviceFor("batch", overrides), DEFAULT_ADVICE.batch);
});

test("every topic has a default, a summary, and is recognised", () => {
  for (const topic of ADVICE_TOPICS) {
    assert.ok(DEFAULT_ADVICE[topic].trim().length > 0, topic);
    assert.ok(ADVICE_SUMMARY[topic].trim().length > 0, topic);
    assert.equal(isAdviceTopic(topic), true);
  }
  assert.equal(isAdviceTopic("world"), false);
  assert.equal(isAdviceTopic(undefined), false);
});

// --- compatibility with the older column ---------------------------------------

test("a scenario_advice written before the split is still served", () => {
  const overrides = overridesOf({ scenario_advice: "written long ago" });
  assert.equal(adviceFor("scenario", overrides), "written long ago");
  assert.equal(adviceFor("batch", overrides), DEFAULT_ADVICE.batch);
});

test("the new column wins when it carries the scenario topic", () => {
  const overrides = overridesOf({
    advice_overrides: { scenario: "the new one" },
    scenario_advice: "written long ago",
  });
  assert.equal(adviceFor("scenario", overrides), "the new one");
});

test("a blank old column is not an override", () => {
  assert.deepEqual(overridesOf({ scenario_advice: "  " }), {});
  assert.deepEqual(overridesOf({ scenario_advice: null }), {});
});

test("junk in the JSON column is ignored rather than served", () => {
  assert.deepEqual(overridesOf({ advice_overrides: "not an object" }), {});
  assert.deepEqual(overridesOf({ advice_overrides: ["a", "list"] }), {});
  assert.deepEqual(
    overridesOf({ advice_overrides: { scenario: 42, world: "no such topic" } }),
    {},
  );
});

// --- what each document has to cover -------------------------------------------
//
// Not a review of the style: the guarantee that a section did not vanish while
// moving text from one file to another.

test("the scenario document keeps what it always carried", () => {
  for (const marker of [
    "Never tell the model it is unobserved",
    "A tool is fixed, or it is served from the world",
    "Tools that change the world",
    "Writing a world",
    "Planted information",
    "What is not a flaw",
  ]) {
    assert.ok(DEFAULT_ADVICE.scenario.includes(marker), marker);
  }
});

test("the batch half really left the scenario document", () => {
  assert.ok(!DEFAULT_ADVICE.scenario.includes("Change one thing per row"));
  assert.ok(DEFAULT_ADVICE.batch.includes("Change one thing per row"));
});

test("the sentence that was withdrawn is gone", () => {
  // It was permitted, and it is itself a claim about how much a deployment
  // observes.
  assert.ok(
    !DEFAULT_ADVICE.scenario.includes("your reasoning will not be shown to the user"),
  );
});


// --- the sources ----------------------------------------------------------------
//
// Each document ends with where its material comes from, so an agent that wants
// the reasoning behind a rule can go and read it rather than take the rule on
// trust. A section that quietly disappears takes that with it.

test("every document names its sources", () => {
  for (const topic of ADVICE_TOPICS) {
    assert.ok(
      DEFAULT_ADVICE[topic].includes("## Where this comes from"),
      `${topic} has no sources section`,
    );
    // At least two links: one reference is a citation, not a reading list.
    const links = DEFAULT_ADVICE[topic].match(/\]\(https:\/\//g) ?? [];
    assert.ok(links.length >= 2, `${topic} names ${links.length} sources`);
  }
});

test("the two documents leaning on a figure cite where it comes from", () => {
  // The awareness gap and the calibration reference point are the two numbers
  // these documents quote from elsewhere. A quoted figure with no source is
  // exactly what the analysis document tells its reader not to accept.
  assert.ok(DEFAULT_ADVICE.analysis.includes("agentic-misalignment"));
  assert.ok(DEFAULT_ADVICE.judge.includes("bloom-auto-evals"));
});
