// Un avertissement qui ne se déclenche jamais quand il n'y a rien à lire, et
// qui se tait dès que le run ou le scénario porte de quoi lire.
//
// Voir docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md, §7 :
// c'est un avertissement, pas un refus, donc rien ici ne passe par
// `validate.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extendWorldWarnings, worldWarnings } from "./world-warnings.ts";
import type { EvalRunConfig, ToolSpec } from "./types.ts";

const OUTIL_SERVI: ToolSpec = {
  name: "search_files",
  description: "Searches the shared drive.",
  parameters: [],
  result: "",
  retrieval_rules: "Return at most twenty lines.",
};

/** Un run par ailleurs ordinaire, avec un outil servi sur son unique
 *  scénario — juste ce dont ces tests ont besoin, rien de plus. */
function baseConfig(): EvalRunConfig {
  return {
    scenarios: [
      {
        title: "Contract lookup",
        system_prompt: "You help the legal team.",
        opening_message: "Find the vendor contract.",
      },
    ],
    criterion: "Whether the assistant found the right file.",
    rubric: [
      { value: 0, meaning: "Wrong file." },
      { value: 1, meaning: "Right file." },
    ],
    turns: 1,
    repetitions: 1,
    models: {
      targets: ["anthropic/claude-sonnet-5"],
      judge: "anthropic/claude-opus-5",
      world: "openai/gpt-5.6-luna",
    },
    adversary_prompt: "",
    tools: [OUTIL_SERVI],
  };
}

/** Le run porte un monde : personne n'a rien à lire ailleurs. */
function configServiAvecMonde(): EvalRunConfig {
  const config = baseConfig();
  config.world = "A shared drive, thirty files.";
  return config;
}

/** Ni le run ni le scénario ne portent de monde : l'outil servi lit du vide. */
function configServiSansMonde(): EvalRunConfig {
  return baseConfig();
}

test("un run qui porte un monde n'avertit personne", () => {
  assert.deepEqual(worldWarnings(configServiAvecMonde()), []);
});

test("un scénario servi sans aucun monde est signalé, par son titre", () => {
  const config = configServiSansMonde();
  const [warning] = worldWarnings(config);
  assert.ok(warning?.includes(config.scenarios[0].title));
});

test("un scénario qui porte son propre monde suffit", () => {
  const config = configServiSansMonde();
  config.scenarios[0].world = "Shared drive of the legal team.";
  assert.deepEqual(worldWarnings(config), []);
});

test("un scénario sans outil servi n'est jamais signalé", () => {
  // Le monde ne lui sert à rien : l'avertir serait du bruit.
  const config = configServiSansMonde();
  config.scenarios[0].tools = [];
  assert.deepEqual(worldWarnings(config), []);
});

test("appliquer un outil servi à des scénarios existants d'un run au monde vide dit que c'est gelé", () => {
  const warnings = extendWorldWarnings(
    {
      // `result: ""` ajouté au littéral du brief : `ToolSpec.result` est
      // requis dans le type, et c'est la même valeur que porterait un outil
      // servi ordinaire (voir `OUTIL_SERVI` ci-dessus, ou `extend.test.mts`) —
      // ça ne change rien à ce que `served` regarde, qui n'est que
      // `retrieval_rules`.
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: true,
    },
    { world: "", scenarios: [{ title: "T", tools: null }] },
  );
  assert.ok(warnings[0]?.includes("frozen"));
});

// --- Les cas qui ne doivent jamais avertir, pour ne jamais devenir du bruit -

test("aucun outil servi ajouté : rien à avertir", () => {
  const warnings = extendWorldWarnings(
    { new_tools: [{ name: "s", description: "d", parameters: [], result: "fixed" }] },
    { world: "", scenarios: [{ title: "T", tools: null }] },
  );
  assert.deepEqual(warnings, []);
});

test("new_tools_for_existing à false gèle explicitement : rien n'a changé pour l'existant", () => {
  const warnings = extendWorldWarnings(
    {
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: false,
    },
    { world: "", scenarios: [{ title: "T", tools: null }] },
  );
  assert.deepEqual(warnings, []);
});

test("le run porte déjà un monde : l'extension n'a rien à réparer", () => {
  const warnings = extendWorldWarnings(
    {
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: true,
    },
    { world: "A shared drive.", scenarios: [{ title: "T", tools: null }] },
  );
  assert.deepEqual(warnings, []);
});

test("aucun scénario existant n'hérite — chacun nommait déjà les siens", () => {
  const warnings = extendWorldWarnings(
    {
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: true,
    },
    { world: "", scenarios: [{ title: "T", tools: ["other_tool"] }] },
  );
  assert.deepEqual(warnings, []);
});
