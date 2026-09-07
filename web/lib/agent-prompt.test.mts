// Ce que le prompt promet à un agent, l'outil doit l'accepter.
//
// Le piège de ce genre de document est de dériver en silence : une règle change
// dans `validate.ts`, le prompt continue de décrire l'ancienne, et un agent rend
// des fichiers refusés sans qu'on comprenne pourquoi. Ces tests lisent le gabarit
// lui-même et le font passer par le lecteur de fichiers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agentModels, agentPrompt, catalogModelOptions, mcpAgentPrompt } from "./agent-prompt.ts";
import { catalog, knownModelIds } from "./catalog.ts";
import { readConfigFile } from "./config-file.ts";
import { DEFAULT_FAVORITE_MODELS } from "./favorite-models.ts";

const MODELS = [
  { id: "anthropic/claude-sonnet-5", label: "Anthropic Claude Sonnet 5" },
  { id: "openai/gpt-5.6-terra", label: "OpenAI GPT-5.6 Terra" },
];

/** Les plafonds d'un profil quelconque, pour les tests qui n'en vérifient pas
 *  le chiffre précis. */
const CAPS = { maxUsdPerRun: 2, maxUsdPerHour: 10 };

/** Les deux sorties du gabarit. Tout ce qui décrit le format doit tenir des
 *  deux côtés : c'est ce que ces tests vérifient en les parcourant ensemble. */
const CHANNELS = [
  { name: "le prompt collé", prompt: agentPrompt(MODELS) },
  { name: "le prompt MCP", prompt: mcpAgentPrompt(MODELS, CAPS) },
];

/** Le premier bloc YAML du prompt, avec ses trous comblés.
 *
 * Extrait du gabarit plutôt que recopié : c'est ce qui fait que le test suit le
 * document quand il change. */
function exampleFrom(prompt: string): string {
  const block = prompt.match(/```yaml\n([\s\S]*?)```/);
  assert.ok(block, "le prompt doit porter un exemple YAML");
  // Plus rien à combler : le gabarit porte désormais de vrais identifiants,
  // tirés du catalogue. « accepté tel quel » est donc littéralement vrai — et
  // c'est le seul état honnête, puisqu'un placeholder passait la validation.
  return block[1];
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
  assert.match(mcpAgentPrompt([], CAPS), /ask me for the model identifiers/);
});

test("le prompt collé porte l'origine qu'on lui donne", () => {
  // Elle arrive chez un agent sans contexte d'hôte : relative, elle ne mène
  // nulle part.
  const prompt = agentPrompt(MODELS, "https://evals.example");
  assert.ok(prompt.includes("https://evals.example/validate"));
});

test("le prompt MCP n'envoie jamais l'agent sur /validate", () => {
  // Il tient l'outil : lui montrer la porte HTTP, c'est le voir la prendre.
  const prompt = mcpAgentPrompt(MODELS, CAPS);
  assert.ok(!prompt.includes("/validate"));
  assert.ok(prompt.includes("submit_draft_run"));
});

test("le prompt MCP promet que rien ne se lance", () => {
  // La raison d'être de ce canal : un agent qui craint de dépenser n'appelle
  // pas l'outil et cherche une porte plus douce, qui n'existe pas.
  assert.match(mcpAgentPrompt(MODELS, CAPS), /Calling it starts nothing/);
});

test("le prompt MCP nomme les outils par lesquels on reprend l'existant", () => {
  // Un outil qui n'est pas dans le prompt n'existe pas pour l'agent : il
  // retaperait un run de cent scénarios à partir de ce qu'il en voit.
  const prompt = mcpAgentPrompt(MODELS, CAPS);
  for (const tool of ["get_run_config", "get_draft_config", "update_draft_run"]) {
    assert.ok(prompt.includes(tool), tool);
  }
});

test("le prompt MCP n'offre pas une forme CSV que l'outil refuse", () => {
  // `submit_draft_run` rend INCOMPLETE en erreur : proposer le CSV ici serait
  // promettre un chemin fermé.
  const prompt = mcpAgentPrompt(MODELS, CAPS);
  assert.ok(!prompt.includes("from: csv"));
  assert.equal([...prompt.matchAll(/```yaml\n/g)].length, 1);
});

test("le prompt MCP ne demande pas d'éditer une ligne avant de le coller", () => {
  // Personne ne le colle : l'expérience est déjà dans la conversation.
  assert.ok(!mcpAgentPrompt(MODELS, CAPS).includes("REPLACE THIS LINE"));
  assert.ok(agentPrompt(MODELS).includes("REPLACE THIS LINE"));
});

test("le prompt MCP donne les plafonds de l'appelant, pas des défauts inventés", () => {
  const prompt = mcpAgentPrompt(MODELS, { maxUsdPerRun: 3.5, maxUsdPerHour: 17 });
  assert.ok(prompt.includes("$3.50"), "le plafond par run doit être lisible");
  assert.ok(prompt.includes("$17.00"), "le plafond par heure doit être lisible");
  assert.ok(prompt.includes("launch_draft"));
  assert.match(prompt, /editable/);
  assert.match(prompt, /can change/);
});

test("le prompt MCP ne devine pas un plafond quand le profil n'a pas pu être lu", () => {
  const prompt = mcpAgentPrompt(MODELS, null);
  assert.ok(!prompt.includes("$2.00"), "aucun défaut codé en dur ne doit apparaître à sa place");
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(prompt), "le trou doit être comblé même sans profil");
  assert.ok(prompt.includes("launch_draft"));
});

test("le prompt annonce le juge d'éveil et le conseil d'écriture", () => {
  // Ce que le prompt omet devient un champ qu'un agent n'écrit jamais, ou un
  // conseil qu'il ne va pas chercher.
  const prompt = agentPrompt(agentModels(DEFAULT_FAVORITE_MODELS), "https://example.test");
  assert.match(prompt, /check_eval_awareness/);
  // Le canal MCP appelle un outil ; le canal HTTP ouvre la route publique
  // dédiée — jamais `/scenarios`, la page privée qu'un agent sans session ne
  // peut pas lire (voir `web/app/scenario-advice/route.ts`).
  assert.match(prompt, /read_scenario_advice|\/scenario-advice/);
});

test("le prompt MCP ne dit plus qu'update_draft_run refuse le brouillon d'un autre", () => {
  // Il dévie : il fourche plutôt que d'écrire sur ce qui n'est pas à
  // l'appelant. Un agent qui lit encore l'ancienne phrase n'essaie jamais.
  const prompt = mcpAgentPrompt(MODELS, CAPS);
  assert.ok(!/refuses a draft that is not/.test(prompt));
  assert.match(prompt, /forks/);
});

// --- Juges multiples --------------------------------------------------------

for (const { name, prompt } of CHANNELS) {
  test(`${name} : le juge secondaire déjà posé dans le gabarit est accepté`, () => {
    // L'exemple porte désormais un juge secondaire — s'il ne validait pas,
    // ce serait promettre un format que l'outil refuse au premier essai.
    const { config } = readConfigFile(exampleFrom(prompt));
    assert.equal(config.judges?.length, 1);
    assert.ok(config.judges?.[0].criterion);
    assert.equal(config.judges?.[0].rubric.length, 2);
  });
}

test("le prompt dit que l'ancien format à un seul juge reste valide tel quel", () => {
  // Un agent qui a appris l'ancien format (criterion/rubric au premier
  // niveau) ne doit pas croire qu'il doit tout réapprendre pour un run à un
  // seul juge.
  const prompt = agentPrompt(MODELS);
  assert.match(prompt, /is the default, and often all you need/);
  assert.match(prompt, /nothing about that changes if\s+you never add another/);
});

test("le prompt dit que chaque juge coûte un appel de modèle par conversation", () => {
  // Le piège déjà mordu une fois avec le juge d'éveil : le devis le comptait
  // mal, personne ne s'en apercevait avant la facture. Un agent qui pose
  // trois juges sans le savoir en déclenche trois fois la dépense.
  const prompt = agentPrompt(MODELS);
  assert.match(prompt, /Every judge is a model call per conversation, at its own model/);
  assert.match(prompt, /Three\s+judges are three times the grading spend/);
  assert.match(prompt, /the estimate already counts each one of them/);
});

test("le prompt dit qu'un agent ne peut pas se déclarer principal depuis `judges`", () => {
  // `readJudges` (`config-file.ts`) ignore silencieusement `system_type` et
  // `is_principal` sur une entrée : un agent qui ne le sait pas pourrait
  // croire avoir posé un second principal, ou un juge système.
  const prompt = agentPrompt(MODELS);
  assert.match(prompt, /system_type[\s\S]*is_principal|is_principal[\s\S]*system_type/);
  assert.match(prompt, /silently ignored/);
});

test("le prompt annonce la section qui apprend à poser plusieurs juges", () => {
  const prompt = agentPrompt(MODELS);
  assert.match(prompt, /## Adding more judges/);
  // La règle du gabarit principal (les deux premières règles d'échelle)
  // s'applique aussi à chaque juge secondaire.
  assert.match(prompt, /Each entry in `judges`, if you add any, needs its own non-empty `criterion`/);
});

// --- agentModels -------------------------------------------------------------

test("agentModels ne publie que les favoris qu'on lui passe", () => {
  // Le prompt publie la liste entière à chaque appel : un agent ne doit y
  // lire que ce qu'il a le droit de lancer, sans quoi il proposera un modèle
  // que submit_draft_run refusera.
  const models = agentModels(["grok/grok-4.6", "anthropic/claude-opus-5"]);
  assert.deepEqual(
    models.map((m) => m.id).sort(),
    ["anthropic/claude-opus-5", "grok/grok-4.6"],
  );
});

test("agentModels garde l'ordre du catalogue, pas celui des favoris", () => {
  // Anthropic vient avant xAI dans le catalogue ; l'ordre des favoris ne
  // doit pas faire varier un texte que deux appels doivent rendre identique.
  const models = agentModels(["grok/grok-4.6", "anthropic/claude-opus-5"]);
  assert.deepEqual(models.map((m) => m.id), [
    "anthropic/claude-opus-5",
    "grok/grok-4.6",
  ]);
});

test("agentModels étiquette le fournisseur avec le modèle", () => {
  const [only] = agentModels(["anthropic/claude-opus-5"]);
  assert.equal(only.label, "Anthropic Claude Opus 5");
});

// --- catalogModelOptions ------------------------------------------------------
//
// Partagée par `agentModels` et par `PromptGuide` : c'est elle qui décide de
// l'étiquette et qui porte le favori de chaque modèle, pour que les deux
// lecteurs ne puissent plus en filtrer un et pas l'autre sans s'en apercevoir.

test("catalogModelOptions ne filtre rien : elle porte le catalogue entier", () => {
  const options = catalogModelOptions(catalog(["anthropic/claude-opus-5"]));
  assert.equal(options.length, knownModelIds().size);
});

test("catalogModelOptions étiquette chaque modèle avec son fournisseur", () => {
  const options = catalogModelOptions(catalog([]));
  const opus = options.find((m) => m.id === "anthropic/claude-opus-5");
  assert.equal(opus?.label, "Anthropic Claude Opus 5");
});

test("catalogModelOptions porte le favori de chaque modèle, sans filtrer", () => {
  const options = catalogModelOptions(catalog(["anthropic/claude-opus-5"]));
  const opus = options.find((m) => m.id === "anthropic/claude-opus-5");
  const other = options.find((m) => m.id !== "anthropic/claude-opus-5");
  assert.equal(opus?.favorite, true);
  assert.equal(other?.favorite, false);
});
