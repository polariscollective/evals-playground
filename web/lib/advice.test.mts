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
import { DEFAULT_SCENARIO_ADVICE, scenarioAdvice } from "./scenario-advice.ts";

test("an absent override falls back to the default", () => {
  assert.equal(adviceFor("analysis", null), DEFAULT_ADVICE.analysis);
  assert.equal(adviceFor("analysis", undefined), DEFAULT_ADVICE.analysis);
  assert.equal(adviceFor("analysis", {}), DEFAULT_ADVICE.analysis);
});

// Vider le champ à l'écran veut dire « remets le défaut », jamais « n'envoie
// plus rien à mon agent ».
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

// --- la compatibilité avec l'ancienne colonne --------------------------------

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

// --- l'alias -----------------------------------------------------------------
//
// `read_scenario_advice` est nommé dans les instructions du serveur MCP et
// interpolé dans `agent-prompt.ts`. Le casser casserait tous les agents déjà
// écrits.

test("the old entry point still serves the scenario document", () => {
  assert.equal(DEFAULT_SCENARIO_ADVICE, DEFAULT_ADVICE.scenario);
  assert.equal(scenarioAdvice(null), DEFAULT_ADVICE.scenario);
  assert.equal(scenarioAdvice("mine"), "mine");
  assert.equal(scenarioAdvice("  "), DEFAULT_ADVICE.scenario);
});

// --- ce que chaque document doit couvrir -------------------------------------
//
// Pas une relecture du style : la garantie qu'une section n'a pas disparu en
// déplaçant du texte d'un fichier à l'autre.

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
  // Elle était autorisée, et c'est elle-même une affirmation sur le degré
  // d'observation d'un déploiement.
  assert.ok(
    !DEFAULT_ADVICE.scenario.includes("your reasoning will not be shown to the user"),
  );
});
