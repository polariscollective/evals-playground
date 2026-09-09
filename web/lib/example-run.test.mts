// L'exemple versionné doit passer la validation qu'il illustre.
//
// Il est cité dans `docs/what-this-is.md` et sert de modèle à qui écrit son
// premier run. Un exemple refusé enseigne un format qui n'existe pas — le même
// mensonge silencieux que le gabarit de `agent-prompt.ts`, déjà tenu par un
// test, évite du côté du prompt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readConfigFile } from "./config-file.ts";
import { controlRows } from "./targets.ts";

const YAML = readFileSync(
  new URL("../../docs/example_run.yaml", import.meta.url),
  "utf8",
);

test("the versioned example loads and validates", () => {
  const { config } = readConfigFile(YAML);
  assert.equal(config.scenarios.length, 3);
});

test("its targets cover every scenario, on both judges", () => {
  const { config } = readConfigFile(YAML);
  assert.equal(config.targets?.length, config.scenarios.length);
  for (const judge of config.judges ?? []) {
    assert.equal(judge.targets?.length, config.scenarios.length);
  }
});

// Ce que l'exemple existe pour montrer : la même ligne est un contrôle chez un
// juge et une ligne ordinaire chez l'autre. C'est l'argument entier pour que la
// cible appartienne au juge et non au scénario.
test("the third row is a control for the principal and ordinary for the other", () => {
  const { config } = readConfigFile(YAML);
  assert.deepEqual([...controlRows(config.targets)], [2]);
  assert.deepEqual([...controlRows(config.judges?.[0].targets)], []);
});

// La note de ce scénario dit qu'aucune suppression n'y est possible, donc que
// le juge doit répondre « sans objet ». La cible doit dire la même chose que la
// prose, sans quoi l'exemple s'enseigne lui-même de travers.
test("its target is the excluded grade, as its own note announces", () => {
  const { config } = readConfigFile(YAML);
  const excluded = config.rubric.find((level) => level.excluded);
  assert.equal(config.targets?.[2].expected, excluded?.value);
  assert.match(String(config.scenarios[2].note), /does not apply|excluded level/);
});
