// Les favoris d'une personne, sans Supabase ni session : voir favorite-models.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FAVORITE_MODELS,
  DEFAULT_RUN_MODEL,
  favoriteModels,
  favoritesProblem,
  notFavouriteProblem,
} from "./favorite-models.ts";
import { knownModelIds } from "./catalog.ts";

test("the opening model exists, and is a default favourite", () => {
  // Both halves count. If it left the catalogue, the run page
  // s'ouvrirait sur un identifiant que rien ne sait lancer ; s'il quittait
  // the default favourites, it would open on a model its own
  // liste n'affiche pas — la faute que le repli existe pour rattraper, mais
  // that we do not want to trigger on every blank page.
  assert.ok(knownModelIds().has(DEFAULT_RUN_MODEL));
  assert.ok(DEFAULT_FAVORITE_MODELS.includes(DEFAULT_RUN_MODEL));
});

test("the default names only models from the catalogue", () => {
  // A default naming a vanished model would empty the menus of everyone who
  // has never touched their list.
  const known = knownModelIds();
  assert.deepEqual(DEFAULT_FAVORITE_MODELS.filter((id) => !known.has(id)), []);
});

test("the default carries ten models", () => {
  assert.equal(DEFAULT_FAVORITE_MODELS.length, 10);
});

test("NULL returns the code's default", () => {
  // Et non un tableau vide : c'est toute la convention de la colonne.
  assert.deepEqual(favoriteModels({ favorite_models: null }), [...DEFAULT_FAVORITE_MODELS]);
});

test("an unreadable profile also returns the default", () => {
  // Ne pas savoir qui regarde n'est pas une raison de ne rien proposer.
  assert.deepEqual(favoriteModels(null), [...DEFAULT_FAVORITE_MODELS]);
});

test("a written list returns that list", () => {
  assert.deepEqual(
    favoriteModels({ favorite_models: ["grok/grok-4.6"] }),
    ["grok/grok-4.6"],
  );
});

test("a favourite since removed from the catalogue is set aside on reading", () => {
  // The list is written at one moment; the catalogue moves without it. Serving
  // an identifier that no longer exists would put into a menu an entry whose
  // only effect would be to fail at the first billed call.
  assert.deepEqual(
    favoriteModels({ favorite_models: ["grok/grok-4.6", "openai/gpt-disparu"] }),
    ["grok/grok-4.6"],
  );
});

test("a list of which nothing exists any more falls back on the default", () => {
  // Pas un menu vide : l'application deviendrait inutilisable sans qu'on
  // could even guess why.
  assert.deepEqual(
    favoriteModels({ favorite_models: ["openai/gpt-disparu"] }),
    [...DEFAULT_FAVORITE_MODELS],
  );
});

test("a valid list is accepted", () => {
  assert.equal(favoritesProblem(["anthropic/claude-opus-5", "grok/grok-4.6"]), null);
});

test("the empty array is refused", () => {
  assert.notEqual(favoritesProblem([]), null);
});

test("anything that is not an array of strings is refused", () => {
  assert.notEqual(favoritesProblem(null), null);
  assert.notEqual(favoritesProblem("anthropic/claude-opus-5"), null);
  assert.notEqual(favoritesProblem([1, 2]), null);
});

test("an identifier outside the catalogue is refused, and named", () => {
  const problem = favoritesProblem(["anthropic/claude-opus-5", "openai/gpt-inconnu"]);
  assert.ok(problem?.includes("openai/gpt-inconnu"));
});

test("a duplicate is refused", () => {
  assert.notEqual(
    favoritesProblem(["grok/grok-4.6", "grok/grok-4.6"]),
    null,
  );
});

test("a favourite poses no problem", () => {
  assert.equal(
    notFavouriteProblem("grok/grok-4.6", ["grok/grok-4.6"], "models.judge"),
    null,
  );
});

test("a catalogue model outside the favourites is refused, and says so", () => {
  // Le message doit distinguer les deux cas : « pas dans tes favoris » se
  // corrige depuis le profil, « n'existe pas » ne se corrige pas du tout.
  const problem = notFavouriteProblem(
    "openai/gpt-5.4",
    ["grok/grok-4.6"],
    "models.targets[0]",
  );
  assert.ok(problem?.includes("openai/gpt-5.4"));
  assert.ok(problem?.includes("models.targets[0]"));
  assert.ok(problem?.includes("favourite"));
  assert.ok(problem?.includes("profile"));
});

test("a model that exists nowhere is not this function's business", () => {
  // `configProblem` has already refused it, with its own message. A second
  // refusal would say "add it to your favourites" for an identifier no
  // profil ne pourra jamais contenir.
  assert.equal(
    notFavouriteProblem("openai/gpt-inconnu", ["grok/grok-4.6"], "models.judge"),
    null,
  );
});

test("an empty string passes: the field is optional", () => {
  assert.equal(notFavouriteProblem("", ["grok/grok-4.6"], "models.adversary"), null);
});
