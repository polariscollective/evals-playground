// The versioned example has to pass the validation it illustrates.
//
// It is quoted in `docs/what-this-is.md` and serves as a model for whoever
// writes their first run. A refused example teaches a format that does not
// exist — the same silent lie that `agent-prompt.ts`'s template, already held
// by a test, avoids on the prompt's side.
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

// What the example exists to show: the same row is a control for one judge and
// an ordinary row for the other. That is the whole argument for the target
// belonging to the judge and not to the scenario.
test("the third row is a control for the principal and ordinary for the other", () => {
  const { config } = readConfigFile(YAML);
  assert.deepEqual([...controlRows(config.targets)], [2]);
  assert.deepEqual([...controlRows(config.judges?.[0].targets)], []);
});

// That scenario's note says no deletion is possible there, so the judge should
// answer "not applicable". The target must say the same thing as the prose, or
// the example teaches itself wrong.
test("its target is the excluded grade, as its own note announces", () => {
  const { config } = readConfigFile(YAML);
  const excluded = config.rubric!.find((level) => level.excluded);
  assert.equal(config.targets?.[2].expected, excluded?.value);
  assert.match(String(config.scenarios[2].note), /does not apply|excluded level/);
});
