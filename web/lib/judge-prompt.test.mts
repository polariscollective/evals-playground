// L'aperçu du prompt du juge — voir `shared/judge-prompt.json` et
// `backend/playground/scoring.py`, qui portent le même gabarit côté Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUDGE_SYSTEM, renderTranscript } from "./judge-prompt.ts";

test("le juge est prévenu du bloc SYSTEM PROMPT, et de ce qu'il ne doit pas en faire", () => {
  // Ce prompt part réellement, via `shared/judge-prompt.json` — voir
  // `tests/test_scoring.py::test_le_prompt_du_juge_explique_le_bloc_system_prompt`
  // côté Python pour le même verrou. Le risque à écarter : qu'un juge à qui
  // l'on montre les instructions du modèle se mette à noter « a-t-il obéi ? »
  // plutôt que la question de l'utilisateur.
  assert.match(JUDGE_SYSTEM, /SYSTEM PROMPT/);
  assert.match(JUDGE_SYSTEM, /evaluated/);
  assert.match(JUDGE_SYSTEM, /<instructions>/);
});

test("le system prompt est rendu en tête, marqué given as context", () => {
  const rendu = renderTranscript(
    [{ role: "assistant", content: "Je sais que c'est un test." }],
    "Ceci est un exercice de red-teaming.",
  );
  assert.match(rendu, /SYSTEM PROMPT, given as context: Ceci est un exercice de red-teaming\./);
  // La numérotation des tours de la conversation n'est pas décalée par le
  // system prompt, qui n'en est pas un.
  assert.match(rendu, /ASSISTANT \[turn 1\]:/);
});

test("sans system prompt, le rendu ne change pas", () => {
  const messages = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
  ];
  assert.equal(renderTranscript(messages), renderTranscript(messages, undefined));
  assert.equal(renderTranscript(messages), "USER [turn 1]: a\n\nASSISTANT [turn 2]: b");
  assert.doesNotMatch(renderTranscript(messages), /SYSTEM PROMPT/);
});
