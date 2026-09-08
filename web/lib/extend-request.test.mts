// La demande d'extension telle que le panneau la compose — voir le
// commentaire de tête d'`extend-request.ts` pour l'histoire du bug que ce
// fichier ferme : `needsWorldModel` (l'écran) et la clé `world` de la demande
// répondaient chacune à leur façon, jusqu'à ce qu'un correctif les
// désaccorde. Ces tests portent sur les cas qui avaient déjà été faux, ou
// pouvaient le redevenir en silence — le serveur se contentant d'agir sur une
// demande qui en dit moins, ou plus, que la personne ne le voulait.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildExtendRequest, needsWorldModel } from "./extend-request.ts";
import type { ExtendPanelValues } from "./extend-request.ts";
import type { EvalModels, EvalRunConfig, EvalScenario, ToolSpec } from "./types";

const SCÉNARIO: EvalScenario = {
  title: "Scénario",
  system_prompt: "Tu tiens le guichet d'une banque en ligne.",
  opening_message: "Je n'arrive plus à ouvrir mon compte.",
};

/** Un outil qui passe par le modèle du monde — `retrieval_rules` rempli,
 *  voir `served` dans `tools.ts`. */
const OUTIL_SERVI: ToolSpec = {
  name: "search_files",
  description: "Cherche dans le disque partagé.",
  parameters: [],
  result: "",
  retrieval_rules: "Rends vingt lignes au plus.",
};

/** Un outil à résultat fixe — jamais servi. */
const OUTIL_FIXE: ToolSpec = {
  name: "solde",
  description: "Rend le solde du compte.",
  parameters: [],
  result: "1200",
};

const MODÈLES = (world: string | null = null): EvalModels => ({
  targets: ["anthropic/claude-sonnet-5"],
  judge: "openai/gpt-5.6-luna",
  world,
});

type Config = Pick<EvalRunConfig, "tools" | "models" | "turns">;

const CONFIG = (overrides: Partial<Config> = {}): Config => ({
  tools: [],
  models: MODÈLES(null),
  turns: 3,
  ...overrides,
});

const VALEURS = (overrides: Partial<ExtendPanelValues> = {}): ExtendPanelValues => ({
  indices: [0],
  newScenarios: [],
  targets: ["anthropic/claude-sonnet-5"],
  repetitions: 1,
  tempMin: "",
  tempMax: "",
  newTools: [],
  forExisting: null,
  worldModel: "",
  turns: 3,
  deepen: null,
  ...overrides,
});

// --- needsWorldModel ---------------------------------------------------

test("needsWorldModel : un run qui sert déjà sans nommer de monde en a besoin, même sans rien ajouter", () => {
  // Le cas que le bug avait ouvert (A1) : servir sans `models.world` est
  // possible pour un run antérieur à ce champ.
  const config = CONFIG({ tools: [OUTIL_SERVI] });
  assert.equal(needsWorldModel(config, []), true);
});

test("needsWorldModel : ajouter un outil servi à un run qui ne sert rien encore en crée le besoin", () => {
  const config = CONFIG({ tools: [] });
  assert.equal(needsWorldModel(config, [OUTIL_SERVI]), true);
});

test("needsWorldModel : un run qui a déjà un monde n'en redemande jamais un", () => {
  const config = CONFIG({ tools: [OUTIL_SERVI], models: MODÈLES("anthropic/claude-sonnet-5") });
  assert.equal(needsWorldModel(config, [OUTIL_SERVI]), false);
});

test("needsWorldModel : rien de servi nulle part, rien à demander", () => {
  const config = CONFIG({ tools: [OUTIL_FIXE] });
  assert.equal(needsWorldModel(config, [OUTIL_FIXE]), false);
});

// --- buildExtendRequest : les quatre cas de `world` ---------------------

test("un run qui sert déjà sans monde, étendu sans ajouter d'outil : world est présent", () => {
  // Le cas que le bug fermait : niché sous `newTools.length > 0`, `world`
  // aurait disparu ici précisément.
  const config = CONFIG({ tools: [OUTIL_SERVI] });
  const request = buildExtendRequest(
    config,
    VALEURS({ newTools: [], worldModel: "anthropic/claude-haiku-4-5" }),
  );
  assert.equal(request.world, "anthropic/claude-haiku-4-5");
});

test("ajouter un outil servi à un run qui ne sert rien encore : world est présent", () => {
  const config = CONFIG({ tools: [] });
  const request = buildExtendRequest(
    config,
    VALEURS({ newTools: [OUTIL_SERVI], worldModel: "anthropic/claude-haiku-4-5" }),
  );
  assert.equal(request.world, "anthropic/claude-haiku-4-5");
  assert.deepEqual(request.new_tools, [OUTIL_SERVI]);
});

test("un run qui a déjà un models.world : world est absent, même si le champ porte une valeur", () => {
  // Le sien est repris silencieusement (`extendRun`) ; en envoyer un autre
  // serait refusé pour rien — la demande ne doit donc jamais porter la clé.
  const config = CONFIG({ tools: [OUTIL_SERVI], models: MODÈLES("anthropic/claude-sonnet-5") });
  const request = buildExtendRequest(
    config,
    VALEURS({ newTools: [], worldModel: "anthropic/claude-haiku-4-5" }),
  );
  assert.equal("world" in request, false);
});

test("rien de servi nulle part : world est absent", () => {
  const config = CONFIG({ tools: [OUTIL_FIXE] });
  const request = buildExtendRequest(
    config,
    VALEURS({ newTools: [OUTIL_FIXE], worldModel: "" }),
  );
  assert.equal("world" in request, false);
});

// --- les autres clés conditionnelles, pour ne pas les casser en passant --

test("new_tools et new_tools_for_existing : absents sans ajout, la réponse ne s'écrit que si elle a été donnée", () => {
  const config = CONFIG();

  const rien = buildExtendRequest(config, VALEURS({ newTools: [] }));
  assert.equal("new_tools" in rien, false);
  assert.equal("new_tools_for_existing" in rien, false);

  const sansRéponse = buildExtendRequest(
    config,
    VALEURS({ newTools: [OUTIL_FIXE], forExisting: null }),
  );
  assert.deepEqual(sansRéponse.new_tools, [OUTIL_FIXE]);
  assert.equal("new_tools_for_existing" in sansRéponse, false);

  const oui = buildExtendRequest(
    config,
    VALEURS({ newTools: [OUTIL_FIXE], forExisting: true }),
  );
  assert.equal(oui.new_tools_for_existing, true);

  const non = buildExtendRequest(
    config,
    VALEURS({ newTools: [OUTIL_FIXE], forExisting: false }),
  );
  assert.equal(non.new_tools_for_existing, false);
});

test("turns : absent quand inchangé, présent quand relevé", () => {
  const config = CONFIG({ turns: 3 });

  const inchangé = buildExtendRequest(config, VALEURS({ turns: 3 }));
  assert.equal("turns" in inchangé, false);

  const relevé = buildExtendRequest(config, VALEURS({ turns: 6 }));
  assert.equal(relevé.turns, 6);
});

test("deepen : absent quand null, écrit sinon — 'all' comme une liste de notes", () => {
  const config = CONFIG();

  const aucun = buildExtendRequest(config, VALEURS({ deepen: null }));
  assert.equal("deepen" in aucun, false);

  const tous = buildExtendRequest(config, VALEURS({ deepen: "all" }));
  assert.equal(tous.deepen, "all");

  const liste = buildExtendRequest(config, VALEURS({ deepen: [0, 1] }));
  assert.deepEqual(liste.deepen, [0, 1]);
});

test("temperature : null quand rien saisi, min repris seul, min et max ensemble", () => {
  const config = CONFIG();

  const rien = buildExtendRequest(config, VALEURS({ tempMin: "", tempMax: "" }));
  assert.equal(rien.temperature, null);

  const minSeul = buildExtendRequest(config, VALEURS({ tempMin: "0.2", tempMax: "" }));
  assert.deepEqual(minSeul.temperature, { min: 0.2, max: null });

  const minEtMax = buildExtendRequest(
    config,
    VALEURS({ tempMin: "0.2", tempMax: "0.8" }),
  );
  assert.deepEqual(minEtMax.temperature, { min: 0.2, max: 0.8 });
});

test("les champs simples traversent tels quels", () => {
  const config = CONFIG();
  const request = buildExtendRequest(
    config,
    VALEURS({
      indices: [0, 2],
      newScenarios: [SCÉNARIO],
      targets: ["anthropic/claude-sonnet-5", "grok/grok-4.3"],
      repetitions: 4,
    }),
  );
  assert.deepEqual(request.scenario_indices, [0, 2]);
  assert.deepEqual(request.new_scenarios, [SCÉNARIO]);
  assert.deepEqual(request.targets, ["anthropic/claude-sonnet-5", "grok/grok-4.3"]);
  assert.equal(request.repetitions, 4);
});
