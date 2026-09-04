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
