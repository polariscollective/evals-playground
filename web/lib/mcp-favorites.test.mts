// The refusal of a model outside the favourites, MCP side only — see
// mcp-favorites.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { configFavouritesProblem, extendFavouritesProblem } from "./mcp-favorites.ts";
import { configProblem } from "./validate.ts";
import type { EvalRunConfig, ExtendRequest } from "./types";

const FAVOURITES = ["anthropic/claude-opus-5", "grok/grok-4.6"];

function config(models: Partial<EvalRunConfig["models"]>): EvalRunConfig {
  return {
    scenarios: [
      {
        title: "s1",
        system_prompt: "system",
        opening_message: "hello",
      },
    ],
    models: {
      targets: ["anthropic/claude-opus-5"],
      adversary: "grok/grok-4.6",
      judge: "anthropic/claude-opus-5",
      ...models,
    },
    turns: 1,
    repetitions: 1,
    criterion: "x",
    rubric: [
      { value: 0, meaning: "bad" },
      { value: 1, meaning: "good" },
    ],
    adversary_prompt: "",
    average_output_tokens: 100,
  } as unknown as EvalRunConfig;
}

test("a configuration entirely within the favourites passes", () => {
  assert.equal(configFavouritesProblem(config({}), FAVOURITES), null);
});

test("an evaluated model outside the favourites is refused, and named", () => {
  const problem = configFavouritesProblem(
    config({ targets: ["anthropic/claude-opus-5", "openai/gpt-5.4"] }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-5.4"));
  assert.ok(problem?.includes("favourite"));
});

test("an adversary outside the favourites is refused", () => {
  const problem = configFavouritesProblem(
    config({ adversary: "openai/gpt-4o" }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("a judge outside the favourites is refused", () => {
  const problem = configFavouritesProblem(
    config({ judge: "openai/gpt-4o" }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("an extra judge outside the favourites is refused", () => {
  const withJudge = config({});
  (withJudge as unknown as { judges: { model: string }[] }).judges = [
    { model: "openai/gpt-4o" },
  ];
  const problem = configFavouritesProblem(withJudge, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("models.world outside the favourites is refused", () => {
  // Without this check, an agent could serve tools with a model it cannot even
  // see in the prompt.
  const problem = configFavouritesProblem(
    config({ world: "openai/gpt-4o" }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("a model that exists nowhere is not refused here", () => {
  // `configProblem` s'en charge, avec son propre message. Deux refus pour la
  // same fault would send you to fix a profile that is not to blame.
  assert.equal(
    configFavouritesProblem(config({ judge: "openai/gpt-inconnu" }), FAVOURITES),
    null,
  );
});

test("a missing adversary is no problem", () => {
  assert.equal(
    configFavouritesProblem(config({ adversary: null }), FAVOURITES),
    null,
  );
});

test("une extension aux cibles en favoris passe", () => {
  const request = { targets: ["grok/grok-4.6"] } as unknown as ExtendRequest;
  assert.equal(extendFavouritesProblem(request, FAVOURITES), null);
});

test("an extension adding a column outside the favourites is refused", () => {
  const request = { targets: ["openai/gpt-4o"] } as unknown as ExtendRequest;
  const problem = extendFavouritesProblem(request, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("a judge added by extension outside the favourites is refused", () => {
  const request = {
    targets: [],
    new_judges: [{ model: "openai/gpt-4o" }],
  } as unknown as ExtendRequest;
  const problem = extendFavouritesProblem(request, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("a judge added with no model takes the run's, and passes", () => {
  const request = {
    targets: [],
    new_judges: [{ criterion: "x" }],
  } as unknown as ExtendRequest;
  assert.equal(extendFavouritesProblem(request, FAVOURITES), null);
});

test("an extension's world outside the favourites is refused", () => {
  // The field `submit_draft_extension` gains in order to serve an added tool:
  // without this check it would escape the bounding every other model already
  // undergoes.
  const problem = extendFavouritesProblem(
    { targets: [], world: "openai/gpt-4o" } as unknown as ExtendRequest,
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("configProblem, for its part, knows nothing of the favourites", () => {
  // The work's boundary, held by a test rather than by goodwill: the day
  // somebody wires the favourites into `validate.ts`,
  // une relance humaine d'un vieux run cesserait de partir, et c'est ici
  // is where it will be learnt, rather than in production.
  const outsideButReal = config({ judge: "openai/gpt-4o" });
  assert.equal(configProblem(outsideButReal), null);
  assert.notEqual(configFavouritesProblem(outsideButReal, FAVOURITES), null);
});
