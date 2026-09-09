// The rule for a valid cap, with no Supabase and no session: see
// profile-caps.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { capProblem, profilePatchProblem } from "./profile-caps.ts";

test("un nombre positif passe, entier ou non", () => {
  assert.equal(capProblem(2), null);
  assert.equal(capProblem(0.5), null);
  assert.equal(capProblem(0.0001), null);
});

test("zero passes: it is the emergency brake", () => {
  // At zero, any strictly positive quote is refused — this person's agents
  // spend nothing any more. It is the only gesture that cuts quickly, and
  // forbidding it closed the door we thought we had left open.
  assert.equal(capProblem(0), null);
});

test("a negative is refused — it would read as zero while saying something else", () => {
  assert.notEqual(capProblem(-1), null);
});

test("an outsized cap is refused: it is a typo", () => {
  // A run costs cents to a few dollars, the defaults are 2 and 10. A cap a slip
  // of the keyboard can lift protects nothing.
  assert.equal(capProblem(100), null);
  assert.notEqual(capProblem(101), null);
  assert.notEqual(capProblem(1000), null);
});

test("anything that is not a finite number is refused", () => {
  assert.notEqual(capProblem(NaN), null);
  assert.notEqual(capProblem(Infinity), null);
  assert.notEqual(capProblem(-Infinity), null);
});

test("anything that is not even of type number is refused", () => {
  // A PATCH request's body is arbitrary JSON before it is checked.
  assert.notEqual(capProblem("2"), null);
  assert.notEqual(capProblem(undefined), null);
  assert.notEqual(capProblem(null), null);
});

test("the advice alone passes: it is the scenarios page's request", () => {
  assert.equal(profilePatchProblem({ scenario_advice: "My rule." }), null);
});

test("the caps alone pass: it is the profile page's request", () => {
  assert.equal(
    profilePatchProblem({ max_usd_per_run: 2, max_usd_per_hour: 10 }),
    null,
  );
});

test("the advice and a single cap are refused together", () => {
  // Choosing which of the two to overwrite would be arbitrary for whoever sent
  // the request — a single cap is enough to make the body mixed.
  assert.notEqual(
    profilePatchProblem({ scenario_advice: "My rule.", max_usd_per_run: 2 }),
    null,
  );
});

test("the advice and both caps are refused together", () => {
  assert.notEqual(
    profilePatchProblem({
      scenario_advice: "My rule.",
      max_usd_per_run: 2,
      max_usd_per_hour: 10,
    }),
    null,
  );
});

test("an empty body passes: nothing to cross", () => {
  // `undefined` everywhere means "touch nothing" on the route side, never a
  // conflict — it is what the route receives when the JSON sent does not parse.
  assert.equal(profilePatchProblem({}), null);
});

test("favorite_models does not travel with the caps", () => {
  // The same reason as the scenario advice: the route applies one thing or the
  // other, and choosing which to overwrite would be arbitrary for the sender.
  assert.notEqual(
    profilePatchProblem({ favorite_models: ["grok/grok-4.6"], max_usd_per_run: 2 }),
    null,
  );
});

test("favorite_models does not travel with the scenario advice", () => {
  assert.notEqual(
    profilePatchProblem({ favorite_models: ["grok/grok-4.6"], scenario_advice: "x" }),
    null,
  );
});

test("favorite_models seul passe", () => {
  assert.equal(profilePatchProblem({ favorite_models: ["grok/grok-4.6"] }), null);
});
