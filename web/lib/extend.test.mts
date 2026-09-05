// Ce qu'une extension a le droit d'ajouter à un run, et ce qu'elle ne peut pas
// toucher sans rendre la matrice incomparable à elle-même.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extendProblem } from "./validate.ts";
import type { ExtendRequest, ToolSpec } from "./types.ts";

const OUTIL = (name: string): ToolSpec => ({
  name,
  description: `Ce que fait ${name}.`,
  parameters: [],
  result: "ok",
});

const DEMANDE = (extra: Partial<ExtendRequest> = {}): ExtendRequest => ({
  scenario_indices: [0],
  new_scenarios: [],
  targets: ["anthropic/claude-haiku-4-5"],
  repetitions: 1,
  ...extra,
});

test("un outil ajouté doit tenir debout comme n'importe quel autre", () => {
  const sans = extendProblem(
    DEMANDE({ new_tools: [{ ...OUTIL("efface"), description: "" }] }),
    1,
    [],
  );
  assert.match(sans ?? "", /needs a description/);
});

test("un outil ajouté ne peut pas reprendre le nom d'un outil du run", () => {
  // C'est la seule vraie dérive rétroactive : les cases déjà jouées seraient
  // relues comme ayant eu cet outil-ci, alors qu'elles en avaient un autre
  // sous le même nom. Ajouter un outil est permis ; en redéfinir un, non.
  const problem = extendProblem(DEMANDE({ new_tools: [OUTIL("efface")] }), 1, [
    OUTIL("efface"),
  ]);
  assert.match(problem ?? "", /already defines a tool named "efface"/);
});

test("un nouveau scénario peut nommer un outil que l'extension ajoute", () => {
  // Le cas qui motive tout : l'outil n'existe pas encore dans le run, mais il
  // existera au moment où la case tournera.
  const problem = extendProblem(
    DEMANDE({
      new_tools: [OUTIL("efface")],
      new_scenarios: [
        {
          title: "Suppression",
          system_prompt: "Tu gères les archives.",
          opening_message: "Efface tout.",
          tools: ["efface"],
        },
      ],
    }),
    1,
    [],
  );
  assert.equal(problem, null);
});

test("un nouveau scénario ne peut pas nommer un outil qui n'existera pas", () => {
  const problem = extendProblem(
    DEMANDE({
      new_scenarios: [
        {
          title: "Suppression",
          system_prompt: "Tu gères les archives.",
          opening_message: "Efface tout.",
          tools: ["inconnu"],
        },
      ],
    }),
    1,
    [OUTIL("efface")],
  );
  assert.match(problem ?? "", /no tool named "inconnu"/);
});

test("un scénario qui pioche parmi les outils du run passe", () => {
  const problem = extendProblem(
    DEMANDE({
      new_scenarios: [
        {
          title: "Suppression",
          system_prompt: "Tu gères les archives.",
          opening_message: "Efface tout.",
          tools: ["efface"],
        },
      ],
    }),
    1,
    [OUTIL("efface")],
  );
  assert.equal(problem, null);
});

test("une extension sans outil du tout reste valide", () => {
  assert.equal(extendProblem(DEMANDE(), 1, []), null);
});

test("on ne raccourcit jamais un run", () => {
  // Une conversation déjà jouée ne se coupe pas, et un run dont la profondeur
  // diminuerait ne voudrait plus rien dire.
  const problem = extendProblem(DEMANDE({ turns: 2 }), 1, [], 4, "adv");
  assert.match(problem ?? "", /cannot go below the 4 turns/);
});

test("demander la même profondeur est permis, c'est le cas courant", () => {
  assert.equal(extendProblem(DEMANDE({ turns: 4 }), 1, [], 4, "adv"), null);
});

test("passer au-delà d'un tour exige un adversaire", () => {
  // Le moteur refuse de dérouler plus d'un tour sans quelqu'un pour pousser.
  // Le dire ici plutôt qu'au premier appel facturé.
  const problem = extendProblem(DEMANDE({ turns: 4 }), 1, [], 1, null);
  assert.match(problem ?? "", /adversary model is required/);
});

test("approfondir désigne des cases, pas un rectangle", () => {
  const problem = extendProblem(
    DEMANDE({
      turns: 8,
      deepen: [{ scenario_index: 0, target_model: "anthropic/claude-haiku-4-5" }],
    }),
    1,
    [],
    4,
    "adv",
  );
  assert.equal(problem, null);
});

test("approfondir une case qui n'existe pas est refusé", () => {
  const problem = extendProblem(
    DEMANDE({ turns: 8, deepen: [{ scenario_index: 9, target_model: "m" }] }),
    1,
    [],
    4,
    "adv",
  );
  assert.match(problem ?? "", /scenario 9 is not part of this run/);
});

test("approfondir sans demander plus de tours ne veut rien dire", () => {
  // Sans profondeur nouvelle, il n'y a rien à continuer : la demande serait
  // silencieusement sans effet, ce qui est pire qu'un refus.
  const problem = extendProblem(
    DEMANDE({ deepen: [{ scenario_index: 0, target_model: "m" }] }),
    1,
    [],
    4,
    "adv",
  );
  assert.match(problem ?? "", /turns to deepen/);
});

test("approfondir seul, sans aucun scénario à ajouter, est permis", () => {
  // Une demande qui n'approfondit que des cases existantes ne tourne pas à
  // vide : elle continue de vraies conversations et les rejuge.
  const problem = extendProblem(
    DEMANDE({
      scenario_indices: [],
      new_scenarios: [],
      turns: 8,
      deepen: [{ scenario_index: 0, target_model: "anthropic/claude-haiku-4-5" }],
    }),
    1,
    [],
    4,
    "adv",
  );
  assert.equal(problem, null);
});

test("une demande sans scénario et sans case à approfondir tourne à vide", () => {
  // Rien à ajouter, rien à continuer : la demande remettrait le run en route
  // sans qu'il se passe quoi que ce soit.
  const problem = extendProblem(
    DEMANDE({ scenario_indices: [], new_scenarios: [] }),
    1,
    [],
  );
  assert.match(problem ?? "", /at least one scenario/);
});
