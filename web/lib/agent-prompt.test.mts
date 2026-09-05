// Ce que le prompt promet à un agent, l'outil doit l'accepter.
//
// Le piège de ce genre de document est de dériver en silence : une règle change
// dans `validate.ts`, le prompt continue de décrire l'ancienne, et un agent rend
// des fichiers refusés sans qu'on comprenne pourquoi. Ces tests lisent le gabarit
// lui-même et le font passer par le lecteur de fichiers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentPrompt, mcpAgentPrompt } from "./agent-prompt.ts";
import { readConfigFile } from "./config-file.ts";

const MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Anthropic Claude Sonnet 5" },
  { id: "openai/gpt-5.6-terra", label: "OpenAI GPT-5.6 Terra" },
];

/** Les deux sorties du gabarit. Tout ce qui décrit le format doit tenir des
 *  deux côtés : c'est ce que ces tests vérifient en les parcourant ensemble. */
const CHANNELS = [
  { name: "le prompt collé", prompt: agentPrompt(MODELS) },
  { name: "le prompt MCP", prompt: mcpAgentPrompt(MODELS) },
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

for (const { name, prompt } of CHANNELS) {
  test(`${name} : le gabarit annoncé est accepté tel quel`, () => {
    const { config, csv } = readConfigFile(exampleFrom(prompt));
    assert.equal(csv, null);
    assert.equal(config.scenarios.length, 1);
    assert.equal(config.turns, 4);
    assert.equal(config.repetitions, 5);
    assert.deepEqual(config.temperature, { min: 0.2, max: 0.8 });
  });

  test(`${name} : le palier « sans objet » est bien exclu de la moyenne`, () => {
    // C'est le seul champ de l'exemple dont l'effet est invisible à la lecture :
    // s'il ne portait pas, la note -1 tirerait chaque case vers le bas.
    const { config } = readConfigFile(exampleFrom(prompt));
    const sansObjet = config.rubric.find((level) => level.value === -1);
    assert.equal(sansObjet?.excluded, true);
  });

  test(`${name} : les identifiants proposés sont ceux du catalogue`, () => {
    // Un modèle inventé meurt au premier appel : le prompt doit porter la liste
    // réelle, telle qu'on la lui passe.
    for (const model of MODELS) assert.ok(prompt.includes(model.id));
    assert.ok(prompt.includes("Anthropic Claude Sonnet 5"));
  });

  test(`${name} : un trou du gabarit non comblé se verrait`, () => {
    assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/);
  });
}

test("la forme CSV décrite plus bas est acceptée elle aussi", () => {
  const prompt = agentPrompt(MODELS);
  const blocks = [...prompt.matchAll(/```yaml\n([\s\S]*?)```/g)];
  assert.ok(blocks.length >= 2, "le prompt doit montrer aussi la forme CSV");
  const scenarios = blocks[1][1];
  const { config, csv } = readConfigFile(
    `criterion: x\nrubric: [{value: 0, meaning: non}, {value: 1, meaning: oui}]\n` +
      `average_output_tokens: 800\n` +
      `turns: 1\nrepetitions: 2\n` +
      `models: {targets: [anthropic/claude-sonnet-5], judge: anthropic/claude-sonnet-5}\n` +
      scenarios,
  );
  assert.deepEqual(config.scenarios, []);
  assert.equal(csv?.column_title, "name");
  assert.equal(csv?.column_opening_message, "question");
});

test("un catalogue vide le dit plutôt que de laisser un trou", () => {
  assert.match(agentPrompt([]), /ask me for the model identifiers/);
  assert.match(mcpAgentPrompt([]), /ask me for the model identifiers/);
});

test("le prompt collé porte l'origine qu'on lui donne", () => {
  // Elle arrive chez un agent sans contexte d'hôte : relative, elle ne mène
  // nulle part.
  const prompt = agentPrompt(MODELS, "https://evals.example");
  assert.ok(prompt.includes("https://evals.example/validate"));
});

test("le prompt MCP n'envoie jamais l'agent sur /validate", () => {
  // Il tient l'outil : lui montrer la porte HTTP, c'est le voir la prendre.
  const prompt = mcpAgentPrompt(MODELS);
  assert.ok(!prompt.includes("/validate"));
  assert.ok(prompt.includes("submit_draft_run"));
});

test("le prompt MCP promet que rien ne se lance", () => {
  // La raison d'être de ce canal : un agent qui craint de dépenser n'appelle
  // pas l'outil et cherche une porte plus douce, qui n'existe pas.
  assert.match(mcpAgentPrompt(MODELS), /Calling it starts nothing/);
});

test("le prompt MCP nomme les outils par lesquels on reprend l'existant", () => {
  // Un outil qui n'est pas dans le prompt n'existe pas pour l'agent : il
  // retaperait un run de cent scénarios à partir de ce qu'il en voit.
  const prompt = mcpAgentPrompt(MODELS);
  for (const tool of ["get_run_config", "get_draft_config", "update_draft_run"]) {
    assert.ok(prompt.includes(tool), tool);
  }
});

test("le prompt MCP n'offre pas une forme CSV que l'outil refuse", () => {
  // `submit_draft_run` rend INCOMPLETE en erreur : proposer le CSV ici serait
  // promettre un chemin fermé.
  const prompt = mcpAgentPrompt(MODELS);
  assert.ok(!prompt.includes("from: csv"));
  assert.equal([...prompt.matchAll(/```yaml\n/g)].length, 1);
});

test("le prompt MCP ne demande pas d'éditer une ligne avant de le coller", () => {
  // Personne ne le colle : l'expérience est déjà dans la conversation.
  assert.ok(!mcpAgentPrompt(MODELS).includes("REPLACE THIS LINE"));
  assert.ok(agentPrompt(MODELS).includes("REPLACE THIS LINE"));
});
