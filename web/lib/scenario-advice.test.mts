// The advice returned to the agent and to the screen: the default, and the rule
// for the override — see scenario-advice.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCENARIO_ADVICE, scenarioAdvice } from "./scenario-advice.ts";

test("with no override, it is the default", () => {
  assert.equal(scenarioAdvice(null), DEFAULT_SCENARIO_ADVICE);
  assert.equal(scenarioAdvice(undefined), DEFAULT_SCENARIO_ADVICE);
});

test("an empty or whitespace override falls back on the default", () => {
  // A field emptied on screen must not deprive the agent of all advice: it is
  // the gesture "put the default back", not "send nothing any more".
  assert.equal(scenarioAdvice(""), DEFAULT_SCENARIO_ADVICE);
  assert.equal(scenarioAdvice("   \n  "), DEFAULT_SCENARIO_ADVICE);
});

test("an override carrying text wins, as it stands", () => {
  assert.equal(scenarioAdvice("A rule of my own."), "A rule of my own.");
});

test("the default is in English and carries the costliest tells", () => {
  // It goes out to a model, like the run-writing prompt: English. These four
  // are the ones nobody guesses alone, and forgetting them would empty the text
  // of what makes it useful.
  assert.match(DEFAULT_SCENARIO_ADVICE, /unobserved|unsupervised/i);
  assert.match(DEFAULT_SCENARIO_ADVICE, /Sarah/);
  assert.match(DEFAULT_SCENARIO_ADVICE, /buried/i);
  assert.match(DEFAULT_SCENARIO_ADVICE, /raw data/i);
});

test("the default holds a structural floor, not only keywords", () => {
  // Looking for four words anywhere in the text lets through an advice reduced
  // to its headings alone, or truncated along the way: the keywords of the test
  // above can all survive inside section titles.
  // A floor on the length and on the number of sections catches an emptying or
  // a massive truncation without freezing the text itself — it is made to be
  // rewritten, so the thresholds keep a wide margin against the real text
  // (5200 characters, 13 "##" sections) rather than hugging today's size.
  assert.ok(
    DEFAULT_SCENARIO_ADVICE.length > 2000,
    `the default is only ${DEFAULT_SCENARIO_ADVICE.length} characters`,
  );
  const sectionCount = (DEFAULT_SCENARIO_ADVICE.match(/^## /gm) ?? []).length;
  assert.ok(
    sectionCount >= 6,
    `the default carries only ${sectionCount} "##" sections`,
  );
});

test("no line of the default carries a quotation prefix", () => {
  // `> ` at the start of a line is the mark of a paste from the design document
  // (a Markdown quotation) rather than a text meant to be served as it stands to
  // a model.
  assert.doesNotMatch(DEFAULT_SCENARIO_ADVICE, /^> /m);
});

test("the advice treats a scenario as four things, tools included", () => {
  // The document described a scenario as prose, with the tools appended. A
  // flawless setting that the first tool call demolishes is a failed scenario,
  // not a successful one with a technical defect.
  assert.match(DEFAULT_SCENARIO_ADVICE, /A scenario is four things/);
  assert.match(DEFAULT_SCENARIO_ADVICE, /## A tool is fixed, or it is served/);
  assert.match(DEFAULT_SCENARIO_ADVICE, /## Writing a world/);
});

test("the sections on tools are no longer relegated to the end of the document", () => {
  // Their place says what is thought of them. After "Planted information",
  // which already speaks of burying things in the world, they would arrive too
  // late.
  const outils = DEFAULT_SCENARIO_ADVICE.indexOf("## A tool is fixed");
  const enfoui = DEFAULT_SCENARIO_ADVICE.indexOf("## Planted information");
  const ouverture = DEFAULT_SCENARIO_ADVICE.indexOf("## The opening message");
  assert.ok(outils > 0 && outils < enfoui);
  assert.ok(enfoui < ouverture);
});
