// Le refus d'un modèle hors favoris, côté MCP seulement — voir mcp-favorites.ts.
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

test("une configuration entièrement en favoris passe", () => {
  assert.equal(configFavouritesProblem(config({}), FAVOURITES), null);
});

test("un modèle évalué hors favoris est refusé, et nommé", () => {
  const problem = configFavouritesProblem(
    config({ targets: ["anthropic/claude-opus-5", "openai/gpt-5.4"] }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-5.4"));
  assert.ok(problem?.includes("favourite"));
});

test("un adversaire hors favoris est refusé", () => {
  const problem = configFavouritesProblem(
    config({ adversary: "openai/gpt-4o" }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge hors favoris est refusé", () => {
  const problem = configFavouritesProblem(
    config({ judge: "openai/gpt-4o" }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge supplémentaire hors favoris est refusé", () => {
  const withJudge = config({});
  (withJudge as unknown as { judges: { model: string }[] }).judges = [
    { model: "openai/gpt-4o" },
  ];
  const problem = configFavouritesProblem(withJudge, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un modèle qui n'existe nulle part n'est pas refusé ici", () => {
  // `configProblem` s'en charge, avec son propre message. Deux refus pour la
  // même faute enverraient corriger un profil qui n'y peut rien.
  assert.equal(
    configFavouritesProblem(config({ judge: "openai/gpt-inconnu" }), FAVOURITES),
    null,
  );
});

test("un adversaire absent ne pose pas de problème", () => {
  assert.equal(
    configFavouritesProblem(config({ adversary: null }), FAVOURITES),
    null,
  );
});

test("une extension aux cibles en favoris passe", () => {
  const request = { targets: ["grok/grok-4.6"] } as unknown as ExtendRequest;
  assert.equal(extendFavouritesProblem(request, FAVOURITES), null);
});

test("une extension qui ajoute une colonne hors favoris est refusée", () => {
  const request = { targets: ["openai/gpt-4o"] } as unknown as ExtendRequest;
  const problem = extendFavouritesProblem(request, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge ajouté par extension hors favoris est refusé", () => {
  const request = {
    targets: [],
    new_judges: [{ model: "openai/gpt-4o" }],
  } as unknown as ExtendRequest;
  const problem = extendFavouritesProblem(request, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge ajouté sans modèle reprend celui du run, et passe", () => {
  const request = {
    targets: [],
    new_judges: [{ criterion: "x" }],
  } as unknown as ExtendRequest;
  assert.equal(extendFavouritesProblem(request, FAVOURITES), null);
});

test("configProblem, lui, ne connaît pas les favoris", () => {
  // La frontière du chantier, tenue par un test plutôt que par la bonne
  // volonté : le jour où quelqu'un câblera les favoris dans `validate.ts`,
  // une relance humaine d'un vieux run cesserait de partir, et c'est ici
  // qu'on l'apprendra plutôt qu'en production.
  const outsideButReal = config({ judge: "openai/gpt-4o" });
  assert.equal(configProblem(outsideButReal), null);
  assert.notEqual(configFavouritesProblem(outsideButReal, FAVOURITES), null);
});
