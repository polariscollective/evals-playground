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

test("le défaut tient un plancher structurel, pas seulement des mots-clés", () => {
  // Chercher quatre mots n'importe où dans le texte laisse passer un conseil
  // réduit à ses seuls titres, ou tronqué en cours de route : les mots-clés
  // du test au-dessus peuvent tous survivre dans les intitulés de section.
  // Une longueur et un nombre de sections plancher attrapent un vidage ou une
  // troncature massive sans figer le texte lui-même — il est fait pour être
  // réécrit, donc les seuils gardent une marge large sur le texte réel
  // (5200 caractères, 13 sections « ## ») plutôt que de coller à sa taille
  // du jour.
  assert.ok(
    DEFAULT_SCENARIO_ADVICE.length > 2000,
    `le défaut ne fait que ${DEFAULT_SCENARIO_ADVICE.length} caractères`,
  );
  const sectionCount = (DEFAULT_SCENARIO_ADVICE.match(/^## /gm) ?? []).length;
  assert.ok(
    sectionCount >= 6,
    `le défaut ne porte que ${sectionCount} sections « ## »`,
  );
});

test("aucune ligne du défaut ne porte un préfixe de citation", () => {
  // `> ` en tête de ligne est la marque d'un recollage depuis le document de
  // conception (une citation Markdown) plutôt qu'un texte pensé pour être
  // servi tel quel à un modèle.
  assert.doesNotMatch(DEFAULT_SCENARIO_ADVICE, /^> /m);
});

test("le conseil traite un scénario comme quatre choses, outils compris", () => {
  // Le document décrivait un scénario comme de la prose, les outils en annexe.
  // Un décor irréprochable que le premier appel d'outil démolit est un scénario
  // raté, pas un scénario réussi avec un défaut technique.
  assert.match(DEFAULT_SCENARIO_ADVICE, /A scenario is four things/);
  assert.match(DEFAULT_SCENARIO_ADVICE, /## A tool is fixed, or it is served/);
  assert.match(DEFAULT_SCENARIO_ADVICE, /## Writing a world/);
});

test("les sections sur les outils ne sont plus reléguées en fin de document", () => {
  // Leur place dit ce qu'on pense d'elles. Après « Planted information », qui
  // parle déjà d'enfouir dans le monde, elles arriveraient trop tard.
  const outils = DEFAULT_SCENARIO_ADVICE.indexOf("## A tool is fixed");
  const enfoui = DEFAULT_SCENARIO_ADVICE.indexOf("## Planted information");
  const ouverture = DEFAULT_SCENARIO_ADVICE.indexOf("## The opening message");
  assert.ok(outils > 0 && outils < enfoui);
  assert.ok(enfoui < ouverture);
});
