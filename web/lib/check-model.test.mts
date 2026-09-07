// Le contrôleur d'un run servi : voir check-model.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkModelFor } from "./check-model.ts";
import { SHARED_WORLD_PROMPT } from "./shared.ts";

const CANDIDATS = ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna"];

test("le contrôleur est d'un autre fournisseur que le serveur", () => {
  assert.equal(
    checkModelFor("openai/gpt-5.6-luna", CANDIDATS),
    "anthropic/claude-haiku-4-5",
  );
  assert.equal(
    checkModelFor("anthropic/claude-haiku-4-5", CANDIDATS),
    "openai/gpt-5.6-luna",
  );
  assert.equal(
    checkModelFor("grok/grok-4.3", CANDIDATS),
    "anthropic/claude-haiku-4-5",
  );
});

test("la liste livrée couvre au moins deux fournisseurs", () => {
  // Sans ça, un serveur de la famille de l'unique candidat se ferait
  // contrôler par lui-même, et le contrôle validerait ses propres erreurs.
  const fournisseurs = new Set(
    (SHARED_WORLD_PROMPT.check_models as string[]).map((id) => id.split("/")[0]),
  );
  assert.ok(fournisseurs.size >= 2);
});
