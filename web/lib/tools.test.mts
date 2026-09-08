import { test } from "node:test";
import assert from "node:assert/strict";
import { fixed, resolvedWorld, served, servesTools } from "./tools.ts";

test("un outil sans règles de lecture est fixe", () => {
  assert.equal(served({ retrieval_rules: undefined }), false);
  assert.equal(served({ retrieval_rules: "" }), false);
  // Des blancs ne sont pas des règles : un champ effacé à moitié dans un
  // formulaire ne doit pas faire basculer l'outil en servi, et donc payer.
  assert.equal(served({ retrieval_rules: "   \n  " }), false);
});

test("un outil avec des règles de lecture est servi", () => {
  assert.equal(served({ retrieval_rules: "Return at most twenty lines." }), true);
});

test("un run sert dès qu'un seul de ses outils sert", () => {
  assert.equal(servesTools([]), false);
  assert.equal(servesTools([{ retrieval_rules: "" }]), false);
  assert.equal(
    servesTools([{ retrieval_rules: "" }, { retrieval_rules: "rules" }]),
    true,
  );
});

// --- fixed -------------------------------------------------------------
//
// IMPORTANT 3 : l'autre moitié de l'exclusion que `served` nomme déjà, et
// null-safe comme lui — `toolsProblem` n'exige jamais `result`, donc un outil
// posé par une requête directe peut en arriver dépourvu, ce que
// `tool.result.trim()` brut (ToolsEditor.tsx) ne survivait pas.

test("un outil sans result n'est pas fixe — et ne fait pas lever la question", () => {
  // `result` n'est pas optionnel dans le type, mais `toolsProblem` ne l'exige
  // jamais : une requête directe peut en poser un sans, exactement le cas
  // que null-safe protège. `as unknown` pour poser ce que le type interdit
  // mais que le runtime peut recevoir.
  assert.equal(fixed({ result: undefined } as unknown as { result: string }), false);
  assert.equal(fixed({ result: "" }), false);
  // Une espace seule ne fixe rien, symétrique de `served` sur les blancs.
  assert.equal(fixed({ result: "   \n  " }), false);
});

test("un outil avec un résultat écrit est fixe", () => {
  assert.equal(fixed({ result: "412 records deleted." }), true);
});

// --- resolvedWorld ----------------------------------------------------------
//
// A2 : trois appelants posaient chacun `config.models.world || request.world
// || null` de son côté — `extendRun` en écrivant, le devis d'une extension en
// le chiffrant, l'écran en l'affichant. Une seule copie désormais.

test("le modèle du run gagne toujours, même face à un autre nommé par la demande", () => {
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: "openai/gpt-5.6-luna" } },
      { world: "grok/grok-4.3" },
    ),
    "openai/gpt-5.6-luna",
  );
});

test("sans modèle de run, celui de la demande comble le vide", () => {
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: null } },
      { world: "openai/gpt-5.6-luna" },
    ),
    "openai/gpt-5.6-luna",
  );
});

test("ni l'un ni l'autre : null, jamais une chaîne vide", () => {
  // C'est précisément ce que `config.models.world ?? ""` dans `pricing.ts`
  // recevrait sans cette résolution : la part servie du devis retomberait
  // sur le modèle "", qui n'a pas de prix et compte pour zéro (A2).
  assert.equal(
    resolvedWorld({ models: { targets: [], judge: "j", world: null } }, { world: null }),
    null,
  );
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: undefined } },
      { world: undefined },
    ),
    null,
  );
});

test("un models.world à une seule espace ne compte pas comme rempli (MINOR)", () => {
  // `||` brut le rendrait quand même — une chaîne non vide est truthy — et le
  // devis chiffrerait la part servie sur ce modèle-là, qu'aucun tarif ne
  // connaît : compté pour zéro, sans que rien ne le dise.
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: "   " } },
      { world: "openai/gpt-5.6-luna" },
    ),
    "openai/gpt-5.6-luna",
  );
  assert.equal(
    resolvedWorld(
      { models: { targets: [], judge: "j", world: "   " } },
      { world: "   " },
    ),
    null,
  );
});
