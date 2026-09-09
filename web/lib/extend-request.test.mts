// La demande d'extension telle que le panneau la compose — voir le
// head comment of `extend-request.ts` for the story of the bug this file
// closes: `needsWorldModel` (the screen) and the request's `world` key each
// answered in their own way, until a fix put them out of agreement. These tests
// bear on the cases that had already been wrong, or
// pouvaient le redevenir en silence — le serveur se contentant d'agir sur une
// demande qui en dit moins, ou plus, que la personne ne le voulait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExtendRequest, needsWorldModel } from "./extend-request.ts";
import type { ExtendPanelValues } from "./extend-request.ts";
import type { EvalModels, EvalRunConfig, EvalScenario, ToolSpec } from "./types";

const SCENARIO: EvalScenario = {
  title: "Scenario",
  system_prompt: "Tu tiens le guichet d'une banque en ligne.",
  opening_message: "I can no longer open my account.",
};

/** A tool that goes through the world model — `retrieval_rules` filled in,
 *  voir `served` dans `tools.ts`. */
const SERVED_TOOL: ToolSpec = {
  name: "search_files",
  description: "Searches the shared drive.",
  parameters: [],
  result: "",
  retrieval_rules: "Rends vingt lignes au plus.",
};

/** A tool with a fixed result — never served. */
const FIXED_TOOL: ToolSpec = {
  name: "solde",
  description: "Rend le solde du compte.",
  parameters: [],
  result: "1200",
};

const MODELS = (world: string | null = null): EvalModels => ({
  targets: ["anthropic/claude-sonnet-5"],
  judge: "openai/gpt-5.6-luna",
  world,
});

type Config = Pick<EvalRunConfig, "tools" | "models" | "turns">;

const CONFIG = (overrides: Partial<Config> = {}): Config => ({
  tools: [],
  models: MODELS(null),
  turns: 3,
  ...overrides,
});

const VALUES = (overrides: Partial<ExtendPanelValues> = {}): ExtendPanelValues => ({
  indices: [0],
  newScenarios: [],
  targets: ["anthropic/claude-sonnet-5"],
  repetitions: 1,
  tempMin: "",
  tempMax: "",
  newTools: [],
  forExisting: null,
  worldModel: "",
  turns: 3,
  deepen: null,
  ...overrides,
});

// --- needsWorldModel ---------------------------------------------------

test("needsWorldModel: a run already serving without naming a world needs one, even with nothing added", () => {
  // Le cas que le bug avait ouvert (A1) : servir sans `models.world` est
  // possible for a run predating this field.
  const config = CONFIG({ tools: [SERVED_TOOL] });
  assert.equal(needsWorldModel(config, []), true);
});

test("needsWorldModel: adding a served tool to a run that serves nothing yet creates the need", () => {
  const config = CONFIG({ tools: [] });
  assert.equal(needsWorldModel(config, [SERVED_TOOL]), true);
});

test("needsWorldModel: a run that already has a world never asks for one again", () => {
  const config = CONFIG({ tools: [SERVED_TOOL], models: MODELS("anthropic/claude-sonnet-5") });
  assert.equal(needsWorldModel(config, [SERVED_TOOL]), false);
});

test("needsWorldModel: nothing served anywhere, nothing to ask for", () => {
  const config = CONFIG({ tools: [FIXED_TOOL] });
  assert.equal(needsWorldModel(config, [FIXED_TOOL]), false);
});

// --- buildExtendRequest : les quatre cas de `world` ---------------------

test("a run already serving without a world, extended with no tool added: world is present", () => {
  // The case the bug closed off: nested under `newTools.length > 0`, `world`
  // would have disappeared precisely here.
  const config = CONFIG({ tools: [SERVED_TOOL] });
  const request = buildExtendRequest(
    config,
    VALUES({ newTools: [], worldModel: "anthropic/claude-haiku-4-5" }),
  );
  assert.equal(request.world, "anthropic/claude-haiku-4-5");
});

test("adding a served tool to a run that serves nothing yet: world is present", () => {
  const config = CONFIG({ tools: [] });
  const request = buildExtendRequest(
    config,
    VALUES({ newTools: [SERVED_TOOL], worldModel: "anthropic/claude-haiku-4-5" }),
  );
  assert.equal(request.world, "anthropic/claude-haiku-4-5");
  assert.deepEqual(request.new_tools, [SERVED_TOOL]);
});

test("a run that already has a models.world: world is absent, even if the field carries a value", () => {
  // Le sien est repris silencieusement (`extendRun`) ; en envoyer un autre
  // would be refused for nothing — the request must therefore never carry the
  // key.
  const config = CONFIG({ tools: [SERVED_TOOL], models: MODELS("anthropic/claude-sonnet-5") });
  const request = buildExtendRequest(
    config,
    VALUES({ newTools: [], worldModel: "anthropic/claude-haiku-4-5" }),
  );
  assert.equal("world" in request, false);
});

test("rien de servi nulle part : world est absent", () => {
  const config = CONFIG({ tools: [FIXED_TOOL] });
  const request = buildExtendRequest(
    config,
    VALUES({ newTools: [FIXED_TOOL], worldModel: "" }),
  );
  assert.equal("world" in request, false);
});

// --- the other conditional keys, so as not to break them in passing ------

test("new_tools and new_tools_for_existing: absent with no addition, the answer is written only if it was given", () => {
  const config = CONFIG();

  const rien = buildExtendRequest(config, VALUES({ newTools: [] }));
  assert.equal("new_tools" in rien, false);
  assert.equal("new_tools_for_existing" in rien, false);

  const withoutAnswer = buildExtendRequest(
    config,
    VALUES({ newTools: [FIXED_TOOL], forExisting: null }),
  );
  assert.deepEqual(withoutAnswer.new_tools, [FIXED_TOOL]);
  assert.equal("new_tools_for_existing" in withoutAnswer, false);

  const oui = buildExtendRequest(
    config,
    VALUES({ newTools: [FIXED_TOOL], forExisting: true }),
  );
  assert.equal(oui.new_tools_for_existing, true);

  const non = buildExtendRequest(
    config,
    VALUES({ newTools: [FIXED_TOOL], forExisting: false }),
  );
  assert.equal(non.new_tools_for_existing, false);
});

test("turns: absent when unchanged, present when raised", () => {
  const config = CONFIG({ turns: 3 });

  const unchanged = buildExtendRequest(config, VALUES({ turns: 3 }));
  assert.equal("turns" in unchanged, false);

  const raised = buildExtendRequest(config, VALUES({ turns: 6 }));
  assert.equal(raised.turns, 6);
});

test("deepen: absent when null, written otherwise — 'all' like a list of grades", () => {
  const config = CONFIG();

  const aucun = buildExtendRequest(config, VALUES({ deepen: null }));
  assert.equal("deepen" in aucun, false);

  const tous = buildExtendRequest(config, VALUES({ deepen: "all" }));
  assert.equal(tous.deepen, "all");

  const liste = buildExtendRequest(config, VALUES({ deepen: [0, 1] }));
  assert.deepEqual(liste.deepen, [0, 1]);
});

test("temperature : null quand rien saisi, min repris seul, min et max ensemble", () => {
  const config = CONFIG();

  const rien = buildExtendRequest(config, VALUES({ tempMin: "", tempMax: "" }));
  assert.equal(rien.temperature, null);

  const minSeul = buildExtendRequest(config, VALUES({ tempMin: "0.2", tempMax: "" }));
  assert.deepEqual(minSeul.temperature, { min: 0.2, max: null });

  const minEtMax = buildExtendRequest(
    config,
    VALUES({ tempMin: "0.2", tempMax: "0.8" }),
  );
  assert.deepEqual(minEtMax.temperature, { min: 0.2, max: 0.8 });
});

test("les champs simples traversent tels quels", () => {
  const config = CONFIG();
  const request = buildExtendRequest(
    config,
    VALUES({
      indices: [0, 2],
      newScenarios: [SCENARIO],
      targets: ["anthropic/claude-sonnet-5", "grok/grok-4.3"],
      repetitions: 4,
    }),
  );
  assert.deepEqual(request.scenario_indices, [0, 2]);
  assert.deepEqual(request.new_scenarios, [SCENARIO]);
  assert.deepEqual(request.targets, ["anthropic/claude-sonnet-5", "grok/grok-4.3"]);
  assert.equal(request.repetitions, 4);
});
