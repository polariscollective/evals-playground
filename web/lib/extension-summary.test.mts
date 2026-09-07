// Ce qu'une extension a fait, en toutes lettres — et surtout ce qu'elle se
// refuse à dire. Les comptes viennent du registre ; quand le devis manque, la
// phrase dit la forme et tait le nombre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseExtension } from "./extension-summary.ts";
import type {
  CostEstimate,
  EvalScenario,
  ExtendRequest,
  RunExtensionLogEntry,
} from "./types";

/** Une demande vide, à compléter par ce que chaque test met à l'épreuve. */
const REQUEST = (extra: Partial<ExtendRequest> = {}): ExtendRequest => ({
  scenario_indices: [],
  new_scenarios: [],
  targets: [],
  repetitions: 0,
  ...extra,
});

/** Un devis réduit au seul champ que ce module lit. Le cast tient parce que
 *  `summariseExtension` ne regarde jamais rien d'autre dessus. */
const ESTIMATE = (conversations: number): CostEstimate =>
  ({ conversations }) as unknown as CostEstimate;

const ENTRY = (
  request: ExtendRequest,
  estimate: CostEstimate | null = null,
): RunExtensionLogEntry =>
  ({
    at: "2026-09-06T16:33:42.873Z",
    by: "sam@polaris.example",
    via: "mcp",
    request,
    estimate,
    cost_before_usd: 0,
  }) as unknown as RunExtensionLogEntry;

const SCENARIO = (title: string): EvalScenario =>
  ({ title, system_prompt: "s", opening_message: "o" }) as unknown as EvalScenario;

const DEUX = [SCENARIO("Lot bloqué avant expédition"), SCENARIO("Balance d'un dossier cloisonné")];

test("des cases ajoutées : la phrase compte les conversations, les lignes nomment les scénarios", () => {
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0, 1],
      targets: ["anthropic/claude-haiku-4-5"],
      repetitions: 1,
    }),
    ESTIMATE(2),
  );
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, [
    "1 essai ajouté sur 2 scénarios × 1 modèle — 2 conversations.",
  ]);
  assert.deepEqual(summary.lines, [
    { label: "Scénarios", values: ["Lot bloqué avant expédition", "Balance d'un dossier cloisonné"] },
    { label: "Modèles", values: ["anthropic/claude-haiku-4-5"] },
  ]);
});

test("un index qui ne pointe sur rien se nomme par son numéro plutôt que de disparaître", () => {
  const entry = ENTRY(
    REQUEST({ scenario_indices: [0, 7], targets: ["m"], repetitions: 1 }),
    ESTIMATE(2),
  );
  const [scenarios] = summariseExtension(entry, DEUX).lines;
  assert.deepEqual(scenarios.values, ["Lot bloqué avant expédition", "scénario 7"]);
});

test("un approfondissement : le compte est le reste du devis, et la profondeur de départ n'est jamais inventée", () => {
  // Neuf essais poussés, aucune case neuve : le devis ne porte que ceux-là.
  const entry = ENTRY(REQUEST({ deepen: [0], turns: 4 }), ESTIMATE(9));
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, ["9 essais notés 0 poussés à 4 tours."]);
  // Rien qui ressemble à « de 3 à 4 » : la profondeur d'avant n'est pas dans
  // le registre.
  assert.ok(!summary.headlines[0].includes(" de "));
});

test("approfondir « all » : la phrase dit tous les essais notés, pas une liste de paliers", () => {
  const entry = ENTRY(REQUEST({ deepen: "all", turns: 6 }), ESTIMATE(4));
  assert.deepEqual(summariseExtension(entry, DEUX).headlines, [
    "4 essais poussés à 6 tours — tous ceux qui étaient notés.",
  ]);
});

test("ajouter et approfondir d'un coup : deux phrases, et le compte de chacune est le sien", () => {
  // Le devis additionne les deux : 2 cases neuves + 5 essais poussés = 7.
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0, 1],
      targets: ["m"],
      repetitions: 1,
      deepen: [0, 1],
      turns: 5,
    }),
    ESTIMATE(7),
  );
  assert.deepEqual(summariseExtension(entry, DEUX).headlines, [
    "1 essai ajouté sur 2 scénarios × 1 modèle — 2 conversations.",
    "5 essais notés 0 ou 1 poussés à 5 tours.",
  ]);
});

test("sans devis, la phrase dit la forme et tait le compte — jamais un zéro", () => {
  const entry = ENTRY(REQUEST({ deepen: [0], turns: 4 }), null);
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, ["Essais notés 0 poussés à 4 tours."]);
  assert.ok(!summary.headlines[0].includes("0 essai"));
});

test("un juge posé : la relecture se compte, et le juge se nomme", () => {
  const entry = ENTRY(
    REQUEST({ new_judges: [{ criterion: "Nomme-t-il la contrainte ?", rubric: [], model: "anthropic/claude-haiku-4-5" }] }),
    ESTIMATE(6),
  );
  const summary = summariseExtension(entry, DEUX);
  assert.deepEqual(summary.headlines, [
    "1 juge ajouté — relu sur 6 conversations déjà jouées.",
  ]);
  assert.deepEqual(summary.lines, [
    { label: "Juges", values: ["Nomme-t-il la contrainte ? (anthropic/claude-haiku-4-5)"] },
  ]);
});

test("plusieurs juges : le total compte des relectures, jamais des conversations", () => {
  // `addEstimates` somme les devis de chaque juge : 6 conversations × 2 juges.
  const entry = ENTRY(
    REQUEST({
      new_judges: [
        { criterion: "A", rubric: [] },
        { criterion: "B", rubric: [] },
      ],
    }),
    ESTIMATE(12),
  );
  assert.deepEqual(summariseExtension(entry, DEUX).headlines, [
    "2 juges ajoutés — 12 relectures sur les conversations déjà jouées.",
  ]);
});

test("outils, température et profondeur seule apparaissent en lignes", () => {
  const entry = ENTRY(
    REQUEST({
      scenario_indices: [0],
      targets: ["m"],
      repetitions: 2,
      new_tools: [{ name: "search_files", description: "d", parameters: [], result: "r" }],
      temperature: { min: 0.2, max: 0.8 },
      turns: 3,
    }),
    ESTIMATE(2),
  );
  const labels = summariseExtension(entry, DEUX).lines.map((line) => line.label);
  assert.deepEqual(labels, ["Scénarios", "Modèles", "Outils", "Température", "Profondeur"]);
});

test("une entrée qui ne demandait rien : aucune phrase, aucune ligne", () => {
  assert.deepEqual(summariseExtension(ENTRY(REQUEST()), DEUX), {
    headlines: [],
    lines: [],
  });
});
