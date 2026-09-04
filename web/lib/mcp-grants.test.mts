import { test } from "node:test";
import assert from "node:assert/strict";
import { TOUCH_INTERVAL_MS, clientLabelOf, needsTouch } from "./mcp-grants.ts";

const NOW = new Date("2026-09-04T12:00:00Z");

test("un grant qui n'a jamais servi se marque", () => {
  assert.equal(needsTouch(null, NOW), true);
});

test("un usage tout frais ne se réécrit pas", () => {
  const recent = new Date(NOW.getTime() - 60_000).toISOString();
  assert.equal(needsTouch(recent, NOW), false);
});

test("passé l'intervalle, on réécrit", () => {
  const old = new Date(NOW.getTime() - TOUCH_INTERVAL_MS - 1).toISOString();
  assert.equal(needsTouch(old, NOW), true);
});

test("une date illisible vaut une date absente", () => {
  // Une colonne figée sur une valeur que personne ne sait relire ne se
  // rattraperait jamais.
  assert.equal(needsTouch("pas une date", NOW), true);
});

test("un agent utilisateur vide ou absent ne devient pas une chaîne vide", () => {
  assert.equal(clientLabelOf(null), null);
  assert.equal(clientLabelOf(undefined), null);
  assert.equal(clientLabelOf("   "), null);
});

test("un agent utilisateur est gardé tel quel, débarrassé de ses bords", () => {
  assert.equal(clientLabelOf("  claude-ai/1.0  "), "claude-ai/1.0");
});

test("une tirade est tronquée plutôt que stockée entière", () => {
  const label = clientLabelOf("x".repeat(500));
  assert.equal(label?.length, 200);
});
