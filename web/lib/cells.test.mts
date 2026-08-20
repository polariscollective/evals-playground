// La construction de la matrice, qui vivait côté Python jusqu'à ce que le job
// cesse de la reconstruire depuis la configuration. Les cas de forme et de
// température viennent de `tests/test_eval_task.py`, ceux d'extension sont
// neufs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cellsForExtension, cellsForRun, coupleKey } from "./cells.ts";
import type { EvalRunConfig, EvalScenario } from "./types.ts";

function scenario(suffix: string): EvalScenario {
  return {
    title: `Scénario ${suffix}`,
    system_prompt: `Tu assistes l'équipe qualité (${suffix}).`,
    opening_message: `Ouverture du scénario ${suffix}.`,
  };
}

function config(overrides: Partial<EvalRunConfig> = {}): EvalRunConfig {
  return {
    scenarios: [scenario("A")],
    criterion: "Le modèle a fourni le plan demandé.",
    rubric: [
      { value: 0, meaning: "Non." },
      { value: 1, meaning: "Oui." },
    ],
    turns: 1,
    repetitions: 4,
    models: { targets: ["mockllm/model"], judge: "mockllm/model" },
    adversary_prompt: "",
    ...overrides,
  };
}

// --- un run neuf ---------------------------------------------------------------

test("une case par triplet scénario × modèle × répétition", () => {
  const cells = cellsForRun(
    config({
      repetitions: 4,
      scenarios: [scenario("A"), scenario("B")],
      models: { targets: ["a/1", "b/2", "c/3"], judge: "m" },
    }),
  );
  assert.equal(cells.length, 24);
});

test("chaque case porte son scénario et son modèle", () => {
  const cells = cellsForRun(
    config({
      repetitions: 1,
      scenarios: [scenario("A"), scenario("B")],
      models: { targets: ["a/1", "b/2"], judge: "m" },
    }),
  );
  const couples = cells
    .map((cell) => `${cell.scenario_index} ${cell.target_model}`)
    .sort();
  assert.deepEqual(couples, ["0 a/1", "0 b/2", "1 a/1", "1 b/2"]);
});

test("les températures recommencent pour chaque couple", () => {
  // Sinon les scénarios suivants hériteraient de températures décalées, et la
  // comparaison porterait sur des réglages différents d'une ligne à l'autre.
  const cells = cellsForRun(
    config({
      repetitions: 3,
      temperature: { min: 0, max: 1 },
      scenarios: [scenario("A"), scenario("B")],
      models: { targets: ["a/1", "b/2"], judge: "m" },
    }),
  );
  const parCouple = new Map<string, (number | null)[]>();
  for (const cell of cells) {
    const key = coupleKey(cell.scenario_index, cell.target_model);
    parCouple.set(key, [...(parCouple.get(key) ?? []), cell.temperature]);
  }
  assert.equal(parCouple.size, 4);
  for (const temperatures of parCouple.values()) {
    assert.deepEqual(temperatures, [0, 0.5, 1]);
  }
});

// --- un run qu'on complète -----------------------------------------------------

test("les répétitions ajoutées continuent la numérotation du couple", () => {
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["a/1"],
    3,
    null,
    new Map([["0 a/1", 3]]),
  );
  assert.deepEqual(
    cells.map((cell) => cell.repetition),
    [4, 5, 6],
  );
});

test("un couple encore jamais couvert commence à zéro", () => {
  // Un modèle neuf sur un scénario ancien : rien à continuer.
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["neuf/1"],
    2,
    null,
    new Map([["0 ancien/1", 7]]),
  );
  assert.deepEqual(
    cells.map((cell) => cell.repetition),
    [0, 1],
  );
});

test("chaque couple reprend là où il en est, indépendamment des autres", () => {
  // Un run complété deux fois n'avance pas au même rythme partout : un modèle
  // ajouté en cours de route a moins de répétitions que les premiers.
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["a/1", "b/2"],
    1,
    null,
    new Map([
      ["0 a/1", 5],
      ["0 b/2", 1],
    ]),
  );
  assert.deepEqual(
    cells.map((cell) => `${cell.target_model}:${cell.repetition}`),
    ["a/1:6", "b/2:2"],
  );
});

test("l'étalement porte sur les répétitions ajoutées, pas sur le total", () => {
  // Trois de plus sur un run qui en avait déjà trois : les nouvelles s'étalent
  // entre les bornes demandées maintenant. Les anciennes gardent la leur, qui
  // est inscrite sur leur ligne et que ce code ne touche pas.
  const cells = cellsForExtension(
    [scenario("A")],
    [0],
    ["a/1"],
    3,
    { min: 0, max: 1 },
    new Map([["0 a/1", 2]]),
  );
  assert.deepEqual(
    cells.map((cell) => cell.temperature),
    [0, 0.5, 1],
  );
});

test("un scénario neuf prend l'indice qui suit ceux du run", () => {
  const scenarios = [scenario("A"), scenario("B"), scenario("Neuf")];
  const cells = cellsForExtension(scenarios, [2], ["a/1"], 1, null, new Map());
  assert.equal(cells.length, 1);
  assert.equal(cells[0].scenario_index, 2);
  assert.equal(cells[0].scenario_title, "Scénario Neuf");
});

test("un indice qui ne désigne aucun scénario est ignoré", () => {
  // Une requête forgée ne doit pas écrire une case dont le job ne saura que
  // faire : il lit le message d'ouverture par cet indice-là.
  const cells = cellsForExtension([scenario("A")], [0, 9], ["a/1"], 1, null, new Map());
  assert.equal(cells.length, 1);
});
