// Le catalogue tient-il debout ? Un modèle proposé sans tarif serait compté
// pour zéro par le devis — un run annoncé gratuit et facturé plein.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, knownModelIds } from "./catalog.ts";
import { SHARED_PRICING } from "./shared.ts";

const NO_FAVOURITES: string[] = [];

test("chaque modèle proposé a un tarif", () => {
  const priced = new Set(Object.keys(SHARED_PRICING.prices));
  const unpriced = [...knownModelIds()].filter((id) => !priced.has(id));
  assert.deepEqual(unpriced, []);
});

test("aucun tarif ne traîne sans modèle qui le porte", () => {
  // L'inverse compte autant : un tarif orphelin est le reste d'un modèle
  // retiré, et il fera croire à une couverture qui n'existe plus.
  const known = knownModelIds();
  const orphans = Object.keys(SHARED_PRICING.prices).filter((id) => !known.has(id));
  assert.deepEqual(orphans, []);
});

test("les quatre fournisseurs sont là, dans l'ordre", () => {
  assert.deepEqual(
    catalog(NO_FAVOURITES).map((p) => p.id),
    ["anthropic", "openai", "grok", "google"],
  );
});

test("le catalogue porte quarante et un modèles", () => {
  assert.equal(knownModelIds().size, 41);
});

test("les sept modèles qui jettent la température sont marqués", () => {
  // Marqués et non retirés : un run à température fixe sur eux est
  // légitime, c'est le balayage qui ne mesurerait rien.
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

test("un modèle sans marque honore la température", () => {
  const haiku = catalog(NO_FAVOURITES)
    .flatMap((p) => p.models)
    .find((m) => m.id === "anthropic/claude-haiku-4-5");
  assert.equal(haiku?.honours_temperature, true);
});

test("les favoris passés sont marqués, et eux seuls", () => {
  const marked = catalog(["anthropic/claude-opus-5", "grok/grok-4.6"])
    .flatMap((p) => p.models)
    .filter((m) => m.favorite)
    .map((m) => m.id)
    .sort();
  assert.deepEqual(marked, ["anthropic/claude-opus-5", "grok/grok-4.6"]);
});
