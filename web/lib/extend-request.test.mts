// The extension request as the panel composes it — see the head comment of
// `extend-request.ts` for the story of the bug this file closes:
// `needsWorldModel` (the screen) and the request's `world` key each answered in
// their own way, until a fix put them out of agreement. These tests bear on the
// cases that had already been wrong, or could silently become so again — the
// server merely acting on a request that says less, or more, than the person
// meant.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildExtendRequest,
  needsAdversary,
  needsWorldModel,
} from "./extend-request.ts";
import type { ExtendPanelValues } from "./extend-request.ts";
import type { EvalModels, EvalRunConfig, EvalScenario, ToolSpec } from "./types";

const SCENARIO: EvalScenario = {
  title: "Scenario",
  system_prompt: "You are on the counter of an online bank.",
  opening_message: "I can no longer open my account.",
};

/** A tool that goes through the world model — `retrieval_rules` filled in, see
 *  `served` in `tools.ts`. */
const SERVED_TOOL: ToolSpec = {
  name: "search_files",
  description: "Searches the shared drive.",
  parameters: [],
  result: "",
  retrieval_rules: "Return at most twenty lines.",
};

/** A tool with a fixed result — never served. */
const FIXED_TOOL: ToolSpec = {
  name: "balance",
  description: "Returns the account balance.",
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
  adversaryModel: "",
  adversaryPrompt: "",
  turns: 3,
  deepen: null,
  ...overrides,
});

// --- needsWorldModel ---------------------------------------------------

test("needsWorldModel: a run already serving without naming a world needs one, even with nothing added", () => {
  // The case the bug had opened (A1): serving with no `models.world` is
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

// --- buildExtendRequest: the four cases of `world` --------------------

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
  // Its own is taken up silently (`extendRun`); sending another one
  // would be refused for nothing — the request must therefore never carry the
  // key.
  const config = CONFIG({ tools: [SERVED_TOOL], models: MODELS("anthropic/claude-sonnet-5") });
  const request = buildExtendRequest(
    config,
    VALUES({ newTools: [], worldModel: "anthropic/claude-haiku-4-5" }),
  );
  assert.equal("world" in request, false);
});

test("nothing served anywhere: world is absent", () => {
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

  const nothing = buildExtendRequest(config, VALUES({ newTools: [] }));
  assert.equal("new_tools" in nothing, false);
  assert.equal("new_tools_for_existing" in nothing, false);

  const withoutAnswer = buildExtendRequest(
    config,
    VALUES({ newTools: [FIXED_TOOL], forExisting: null }),
  );
  assert.deepEqual(withoutAnswer.new_tools, [FIXED_TOOL]);
  assert.equal("new_tools_for_existing" in withoutAnswer, false);

  const yes = buildExtendRequest(
    config,
    VALUES({ newTools: [FIXED_TOOL], forExisting: true }),
  );
  assert.equal(yes.new_tools_for_existing, true);

  const no = buildExtendRequest(
    config,
    VALUES({ newTools: [FIXED_TOOL], forExisting: false }),
  );
  assert.equal(no.new_tools_for_existing, false);
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

  const none = buildExtendRequest(config, VALUES({ deepen: null }));
  assert.equal("deepen" in none, false);

  const all = buildExtendRequest(config, VALUES({ deepen: "all" }));
  assert.equal(all.deepen, "all");

  const list = buildExtendRequest(config, VALUES({ deepen: [0, 1] }));
  assert.deepEqual(list.deepen, [0, 1]);
});

test("temperature: null when nothing typed, min alone taken up, min and max together", () => {
  const config = CONFIG();

  const nothing = buildExtendRequest(config, VALUES({ tempMin: "", tempMax: "" }));
  assert.equal(nothing.temperature, null);

  const minAlone = buildExtendRequest(config, VALUES({ tempMin: "0.2", tempMax: "" }));
  assert.deepEqual(minAlone.temperature, { min: 0.2, max: null });

  const minAndMax = buildExtendRequest(
    config,
    VALUES({ tempMin: "0.2", tempMax: "0.8" }),
  );
  assert.deepEqual(minAndMax.temperature, { min: 0.2, max: 0.8 });
});

test("the plain fields travel through as they are", () => {
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

// --- needsAdversary ----------------------------------------------------
//
// See docs/superpowers/specs/2026-09-10-an-adversary-and-the-turns-it-needs-design.md.
// One predicate for two questions that must stay one, exactly as
// `needsWorldModel` above: the panel shows the two fields by it, and the request
// carries them by it. When those answers came from two expressions, the screen
// demanded a field it then left out of the request, and the server refused with
// the very message that had sent the person there.

test("needsAdversary: a single-turn run taken beyond one turn needs one", () => {
  assert.equal(needsAdversary(CONFIG({ models: MODELS() }), 2), true);
});

test("needsAdversary: a run that already has one never asks again", () => {
  const config = CONFIG({
    models: { ...MODELS(), adversary: "grok/grok-4.6" },
  });
  assert.equal(needsAdversary(config, 6), false);
});

test("needsAdversary: staying at one turn asks for nothing", () => {
  assert.equal(needsAdversary(CONFIG({ models: MODELS() }), 1), false);
});

test("the request carries the pair exactly when it is needed", () => {
  const config = CONFIG({ models: MODELS(), turns: 1 });
  const request = buildExtendRequest(
    config,
    VALUES({
      turns: 2,
      adversaryModel: "anthropic/claude-haiku-4-5",
      adversaryPrompt: "You play a customer in a hurry.",
    }),
  );
  assert.equal(request.adversary, "anthropic/claude-haiku-4-5");
  assert.equal(request.adversary_prompt, "You play a customer in a hurry.");
});

test("a run that already has an adversary is never sent one back", () => {
  // `extendProblem` refuses the pair outright on such a run: sending what the
  // panel happens to be holding would turn a legitimate deepening into a
  // refusal.
  const config = CONFIG({
    models: { ...MODELS(), adversary: "grok/grok-4.6" },
    turns: 4,
  });
  const request = buildExtendRequest(
    config,
    VALUES({
      turns: 6,
      adversaryModel: "anthropic/claude-haiku-4-5",
      adversaryPrompt: "Something else.",
    }),
  );
  assert.equal("adversary" in request, false);
  assert.equal("adversary_prompt" in request, false);
});

test("an extension that stays at one turn carries no adversary", () => {
  const config = CONFIG({ models: MODELS(), turns: 1 });
  const request = buildExtendRequest(
    config,
    VALUES({
      turns: 1,
      adversaryModel: "anthropic/claude-haiku-4-5",
      adversaryPrompt: "You play a customer in a hurry.",
    }),
  );
  assert.equal("adversary" in request, false);
});
