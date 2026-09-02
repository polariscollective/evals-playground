// Ce que les pastilles doivent garder distinct.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scenarioBadges } from "./scenario-summary.ts";
import type { EvalScenario } from "./types";

const NU: EvalScenario = {
  title: "T",
  system_prompt: "S",
  opening_message: "O",
};

test("un scénario ordinaire ne porte aucune pastille", () => {
  assert.deepEqual(scenarioBadges(NU), []);
  // Les formes vides sont le même cas, et doivent le rester : sans quoi tout
  // un lot importé porterait trois pastilles par ligne, qui ne diraient rien.
  assert.deepEqual(scenarioBadges({ ...NU, note: "", history: [] }), []);
  assert.deepEqual(scenarioBadges({ ...NU, note: "   " }), []);
});

test("les trois états des outils restent distincts à l'écran", () => {
  // C'est la raison d'être des pastilles : `absent` et `none` produisent la
  // même liste vide côté modèle, et sont deux expériences différentes.
  assert.deepEqual(scenarioBadges({ ...NU, tools: null }), []);
  assert.deepEqual(scenarioBadges({ ...NU, tools: [] }), ["no tools"]);
  assert.deepEqual(scenarioBadges({ ...NU, tools: ["a"] }), ["1 tool"]);
  assert.deepEqual(scenarioBadges({ ...NU, tools: ["a", "b"] }), ["2 tools"]);
});

test("un historique posé se compte, au singulier comme au pluriel", () => {
  const turn = { role: "user" as const, content: "x" };
  assert.deepEqual(scenarioBadges({ ...NU, history: [turn] }), [
    "1 seeded turn",
  ]);
  assert.deepEqual(scenarioBadges({ ...NU, history: [turn, turn] }), [
    "2 seeded turns",
  ]);
});

test("les pastilles arrivent dans l'ordre où on les lit", () => {
  assert.deepEqual(
    scenarioBadges({
      ...NU,
      note: "pourquoi",
      history: [{ role: "user", content: "x" }],
      tools: [],
    }),
    ["note", "1 seeded turn", "no tools"],
  );
});
