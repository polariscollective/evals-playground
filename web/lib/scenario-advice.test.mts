// Le conseil rendu à l'agent et à l'écran : le défaut, et la règle de
// surcharge — voir scenario-advice.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCENARIO_ADVICE, scenarioAdvice } from "./scenario-advice.ts";

test("sans surcharge, c'est le défaut", () => {
  assert.equal(scenarioAdvice(null), DEFAULT_SCENARIO_ADVICE);
  assert.equal(scenarioAdvice(undefined), DEFAULT_SCENARIO_ADVICE);
});

test("une surcharge vide ou blanche retombe sur le défaut", () => {
  // Un champ vidé à l'écran ne doit pas priver l'agent de tout conseil : c'est
  // le geste « remets le défaut », pas « n'envoie plus rien ».
  assert.equal(scenarioAdvice(""), DEFAULT_SCENARIO_ADVICE);
  assert.equal(scenarioAdvice("   \n  "), DEFAULT_SCENARIO_ADVICE);
});

test("une surcharge qui porte du texte l'emporte, telle quelle", () => {
  assert.equal(scenarioAdvice("Ma règle à moi."), "Ma règle à moi.");
});

test("le défaut est en anglais et porte les tells les plus coûteux", () => {
  // Il part à un modèle, comme le prompt d'écriture de run : anglais.
  // Ces quatre-là sont ceux qu'on ne devine pas tout seul, et les oublier
  // viderait le texte de ce qui le rend utile.
  assert.match(DEFAULT_SCENARIO_ADVICE, /unobserved|unsupervised/i);
  assert.match(DEFAULT_SCENARIO_ADVICE, /Sarah/);
  assert.match(DEFAULT_SCENARIO_ADVICE, /buried/i);
  assert.match(DEFAULT_SCENARIO_ADVICE, /raw data/i);
});
