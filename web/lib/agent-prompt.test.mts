// Ce que le prompt promet à un agent, l'outil doit l'accepter.
//
// Le piège de ce genre de document est de dériver en silence : une règle change
// dans `validate.ts`, le prompt continue de décrire l'ancienne, et un agent rend
// des fichiers refusés sans qu'on comprenne pourquoi. Ces tests lisent le gabarit
// lui-même et le font passer par le lecteur de fichiers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPrompt } from "./agent-prompt.ts";
import { readConfigFile } from "./config-file.ts";

const MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Anthropic Claude Sonnet 5" },
  { id: "openai/gpt-5.6-terra", label: "OpenAI GPT-5.6 Terra" },
];

/** Le premier bloc YAML du prompt, avec ses trous comblés.
 *
 * Extrait du gabarit plutôt que recopié : c'est ce qui fait que le test suit le
 * document quand il change. */
function exampleFrom(prompt: string): string {
  const block = prompt.match(/```yaml\n([\s\S]*?)```/);
  assert.ok(block, "le prompt doit porter un exemple YAML");
  return block[1]
    .replace("targets: [ ... ]", "targets: [anthropic/claude-sonnet-5]")
    .replace("adversary: ...", "adversary: openai/gpt-5.6-terra")
    .replace("judge: ...", "judge: anthropic/claude-sonnet-5");
}

test("le gabarit annoncé par le prompt est accepté tel quel", () => {
  const { config, csv } = readConfigFile(exampleFrom(agentPrompt(MODELS)));
  assert.equal(csv, null);
  assert.equal(config.scenarios.length, 1);
  assert.equal(config.turns, 4);
  assert.equal(config.repetitions, 5);
  assert.deepEqual(config.temperature, { min: 0.2, max: 0.8 });
});

test("le palier « sans objet » de l'exemple est bien exclu de la moyenne", () => {
  // C'est le seul champ de l'exemple dont l'effet est invisible à la lecture :
  // s'il ne portait pas, la note -1 tirerait chaque case vers le bas.
  const { config } = readConfigFile(exampleFrom(agentPrompt(MODELS)));
  const sansObjet = config.rubric.find((level) => level.value === -1);
  assert.equal(sansObjet?.excluded, true);
});

test("la forme CSV décrite plus bas est acceptée elle aussi", () => {
  const prompt = agentPrompt(MODELS);
  const blocks = [...prompt.matchAll(/```yaml\n([\s\S]*?)```/g)];
  assert.ok(blocks.length >= 2, "le prompt doit montrer aussi la forme CSV");
  const scenarios = blocks[1][1];
  const { config, csv } = readConfigFile(
    `criterion: x\nrubric: [{value: 0, meaning: non}, {value: 1, meaning: oui}]\n` +
      `turns: 1\nrepetitions: 2\n` +
      `models: {targets: [anthropic/claude-sonnet-5], judge: anthropic/claude-sonnet-5}\n` +
      scenarios,
  );
  assert.deepEqual(config.scenarios, []);
  assert.equal(csv?.column_title, "name");
  assert.equal(csv?.column_opening_message, "question");
});

test("les identifiants proposés sont ceux du catalogue, pas des exemples figés", () => {
  // Un modèle inventé meurt au premier appel : le prompt doit porter la liste
  // réelle, telle que la page la reçoit.
  const prompt = agentPrompt(MODELS);
  for (const model of MODELS) assert.ok(prompt.includes(model.id));
  assert.ok(prompt.includes("Anthropic Claude Sonnet 5"));
});

test("un catalogue vide le dit plutôt que de laisser un trou", () => {
  assert.match(agentPrompt([]), /ask me for the model identifiers/);
});
