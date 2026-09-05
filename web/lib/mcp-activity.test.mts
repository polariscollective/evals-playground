// La phrase de l'heure glissante, sans Supabase : voir mcp-activity.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { activitySentence } from "./mcp-activity.ts";

test("zéro lancement se dit calmement, pas comme un tableau vide", () => {
  assert.equal(
    activitySentence(0, 0),
    "No run or extension launched by an agent in the last hour.",
  );
});

test("le singulier et le pluriel restent distincts", () => {
  assert.match(
    activitySentence(1, 0.5),
    /^1 agent-triggered launch in the last hour/,
  );
  assert.match(
    activitySentence(3, 0.5),
    /^3 agent-triggered launches in the last hour/,
  );
});

test("un montant sous le centime ne s'affiche pas $0.00 — une extension minuscule reste réelle", () => {
  const sentence = activitySentence(1, 0.0007);
  assert.match(sentence, /\$0\.0007/);
  assert.doesNotMatch(sentence, /\$0\.00\b/);
});

test("un montant au-dessus du centime garde deux décimales", () => {
  assert.match(activitySentence(2, 1.5), /\$1\.50/);
});
