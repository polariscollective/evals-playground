// Does the catalogue hold up? A model offered with no price would be counted
// as zero by the quote — a run announced free and billed in full.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, knownModelIds } from "./catalog.ts";
import { SHARED_PRICING } from "./shared.ts";

const NO_FAVOURITES: string[] = [];

test("every model offered has a price", () => {
  const priced = new Set(Object.keys(SHARED_PRICING.prices));
  const unpriced = [...knownModelIds()].filter((id) => !priced.has(id));
  assert.deepEqual(unpriced, []);
});

test("no price is left lying without a model carrying it", () => {
  // The converse counts as much: an orphaned price is the remains of a model
  // that was removed, and it will suggest a coverage that no longer exists.
  const known = knownModelIds();
  const orphans = Object.keys(SHARED_PRICING.prices).filter((id) => !known.has(id));
  assert.deepEqual(orphans, []);
});

test("the four providers are there, in order", () => {
  assert.deepEqual(
    catalog(NO_FAVOURITES).map((p) => p.id),
    ["anthropic", "openai", "grok", "google"],
  );
});

test("the catalogue carries forty-one models", () => {
  assert.equal(knownModelIds().size, 41);
});

test("the seven models that discard temperature are marked", () => {
  // Marked and not removed: a fixed-temperature run on them is legitimate; it
  // is the sweep that would measure nothing.
  const ignoring = catalog(NO_FAVOURITES)
    .flatMap((p) => p.models)
    .filter((m) => !m.honours_temperature)
    .map((m) => m.id)
    .sort();
  assert.deepEqual(ignoring, [
    "anthropic/claude-fable-5",
    "anthropic/claude-fable-5-1",
    "anthropic/claude-opus-4-7",
    "anthropic/claude-opus-4-8",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
    "openai/gpt-6-astra",
  ]);
});

test("a model with no mark honours temperature", () => {
  const haiku = catalog(NO_FAVOURITES)
    .flatMap((p) => p.models)
    .find((m) => m.id === "anthropic/claude-haiku-4-5");
  assert.equal(haiku?.honours_temperature, true);
});

test("the favourites passed in are marked, and only those", () => {
  const marked = catalog(["anthropic/claude-opus-5", "grok/grok-4.6"])
    .flatMap((p) => p.models)
    .filter((m) => m.favorite)
    .map((m) => m.id)
    .sort();
  assert.deepEqual(marked, ["anthropic/claude-opus-5", "grok/grok-4.6"]);
});
