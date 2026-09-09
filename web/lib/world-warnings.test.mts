// A warning that never fires when there is nothing to read, and that keeps
// quiet as soon as the run or the scenario carries something to read.
//
// Voir docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md, §7 :
// c'est un avertissement, pas un refus, donc rien ici ne passe par
// `validate.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extendWorldWarnings,
  worldWarnings,
  writeWithoutReadWarnings,
} from "./world-warnings.ts";
import type { EvalRunConfig, ToolSpec } from "./types.ts";

const OUTIL_SERVI: ToolSpec = {
  name: "search_files",
  description: "Searches the shared drive.",
  parameters: [],
  result: "",
  retrieval_rules: "Return at most twenty lines.",
};

/** Un run par ailleurs ordinaire, avec un outil servi sur son unique
 *  scenario — just what these tests need, nothing more. */
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

/** The run carries a world: nobody has anything to read elsewhere. */
function configServiAvecMonde(): EvalRunConfig {
  const config = baseConfig();
  config.world = "A shared drive, thirty files.";
  return config;
}

/** Neither the run nor the scenario carries a world: the served tool reads
 *  emptiness. */
function configServiSansMonde(): EvalRunConfig {
  return baseConfig();
}

test("un run qui porte un monde n'avertit personne", () => {
  assert.deepEqual(worldWarnings(configServiAvecMonde()), []);
});

test("a scenario served with no world at all is reported, by its title", () => {
  const config = configServiSansMonde();
  const [warning] = worldWarnings(config);
  assert.ok(warning?.includes(config.scenarios[0].title));
});

test("a scenario carrying its own world is enough", () => {
  const config = configServiSansMonde();
  config.scenarios[0].world = "Shared drive of the legal team.";
  assert.deepEqual(worldWarnings(config), []);
});

test("a scenario with no served tool is never reported", () => {
  // The world is of no use to it: warning it would be noise.
  const config = configServiSansMonde();
  config.scenarios[0].tools = [];
  assert.deepEqual(worldWarnings(config), []);
});

test("an existing scenario that already carries its world is not warned", () => {
  // The false positive the first version produced: it looked only at the run's
  // world. A scenario carrying its own has something to read, nothing is
  // missing for it, and nothing is frozen for it. Shouting here would teach
  // people to stop reading the warning — the only way to make it useless.
  const warnings = extendWorldWarnings(
    {
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: true,
    },
    {
      world: "",
      scenarios: [{ title: "T", tools: null, world: "Shared drive of the legal team." }],
    },
  );
  assert.deepEqual(warnings, []);
});

test("applying a served tool to existing scenarios of a run with an empty world says it is frozen", () => {
  const warnings = extendWorldWarnings(
    {
      // `result: ""` added to the brief's literal: `ToolSpec.result` is
      // required in the type, and it is the same value a tool would carry
      // servi ordinaire (voir `OUTIL_SERVI` ci-dessus, ou `extend.test.mts`) —
      // it changes nothing about what `served` looks at, which is only
      // `retrieval_rules`.
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: true,
    },
    { world: "", scenarios: [{ title: "T", tools: null, world: "" }] },
  );
  assert.ok(warnings[0]?.includes("frozen"));
});

// --- Les cas qui ne doivent jamais avertir, pour ne jamais devenir du bruit -

test("no served tool added: nothing to warn about", () => {
  const warnings = extendWorldWarnings(
    { new_tools: [{ name: "s", description: "d", parameters: [], result: "fixed" }] },
    { world: "", scenarios: [{ title: "T", tools: null, world: "" }] },
  );
  assert.deepEqual(warnings, []);
});

test("new_tools_for_existing at false freezes explicitly: nothing changed for what exists", () => {
  const warnings = extendWorldWarnings(
    {
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: false,
    },
    { world: "", scenarios: [{ title: "T", tools: null, world: "" }] },
  );
  assert.deepEqual(warnings, []);
});

test("the run already carries a world: the extension has nothing to repair", () => {
  const warnings = extendWorldWarnings(
    {
      new_tools: [
        { name: "s", description: "d", parameters: [], result: "", retrieval_rules: "r" },
      ],
      new_tools_for_existing: true,
    },
    { world: "A shared drive.", scenarios: [{ title: "T", tools: null, world: "" }] },
  );
  assert.deepEqual(warnings, []);
});

test("no existing scenario inherits — each already named its own", () => {
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

// --- Writing into a world nothing reads -----------------------------------

const writer = {
  name: "delete_file",
  description: "Deletes.",
  parameters: [],
  result: "Deleted.",
  world_effect: "The file no longer exists.",
};

const reader = {
  name: "search_files",
  description: "Searches.",
  parameters: [],
  result: "",
  retrieval_rules: "Return at most twenty lines.",
};

const runWith = (tools: unknown[], scenarioTools?: string[] | null) =>
  ({
    scenarios: [
      {
        title: "Rappel",
        system_prompt: "s",
        opening_message: "o",
        ...(scenarioTools === undefined ? {} : { tools: scenarioTools }),
      },
    ],
    world: "A shared drive.",
    tools,
  }) as never;

test("a declared effect nothing will read is reported, by the scenario's title", () => {
  // `world_effect` has one reader only: the environment model, when it serves a
  // call that comes afterwards. With no served tool, the entry is written and is
  // never
  // jamais relue.
  const warnings = writeWithoutReadWarnings(runWith([writer]));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Rappel/);
  assert.match(warnings[0], /never read/);
});

test("a scenario that reads the world is not reported", () => {
  assert.deepEqual(writeWithoutReadWarnings(runWith([writer, reader])), []);
});

test("a run with no writing tool has nothing to report", () => {
  assert.deepEqual(writeWithoutReadWarnings(runWith([reader])), []);
});

test("the question is asked scenario by scenario, not run by run", () => {
  // `tools: none` on this row: it receives neither the writer nor the reader,
  // so it writes nothing and has nothing to report.
  assert.deepEqual(
    writeWithoutReadWarnings(runWith([writer, reader], [])),
    [],
  );
  // And the row that receives ONLY the writer is reported.
  assert.equal(
    writeWithoutReadWarnings(runWith([writer, reader], ["delete_file"])).length,
    1,
  );
});
