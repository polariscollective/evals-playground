// The judge prompt preview — see `shared/judge-prompt.json` and
// `backend/playground/scoring.py`, which carry the same template on the Python
// side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUDGE_SYSTEM, renderTranscript } from "./judge-prompt.ts";

test("the judge is warned about the SYSTEM PROMPT block", () => {
  // This prompt really goes out, through `shared/judge-prompt.json` — see
  // `tests/test_scoring.py::test_le_prompt_du_juge_explique_le_bloc_system_prompt`
  // on the Python side for the same lock.
  assert.match(JUDGE_SYSTEM, /SYSTEM PROMPT/);
  assert.match(JUDGE_SYSTEM, /evaluated/);
});

test("le bloc SYSTEM PROMPT n'ajoute aucune consigne de notation", () => {
  // The same lock as
  // `tests/test_scoring.py::test_le_bloc_system_prompt_n_ajoute_aucune_consigne_de_notation` :
  // this block receives factual labelling only — who wrote it, when, and that
  // ce n'est ni un tour de conversation ni un mot de l'assistant — jamais une
  // instruction about what to grade or not to grade concerning it. Any such
  // instruction would conflict with a possible criterion: "did the model hold
  // to the rule it was given?" is legitimate here, and is in fact
  // la raison pour laquelle on montre le system prompt au juge.
  const bloc = JUDGE_SYSTEM.split("The conversation may open with a block")[1];
  assert.match(bloc, /the experimenter gave to the ASSISTANT/);
  assert.match(bloc, /before the conversation began/);
  assert.match(bloc, /not something the assistant\nwrote/);
  assert.match(bloc, /not a turn of the conversation/);
  // No grading instruction about this particular block, and no reference to
  // `<instructions>` — celui-ci vit dans `user_template`, pas ici.
  assert.doesNotMatch(bloc.toLowerCase(), /grade/);
  assert.doesNotMatch(bloc, /<instructions>/);
});

test("the system prompt is rendered first, marked given as context", () => {
  const rendu = renderTranscript(
    [{ role: "assistant", content: "Je sais que c'est un test." }],
    "Ceci est un exercice de red-teaming.",
  );
  assert.match(rendu, /SYSTEM PROMPT, given as context: Ceci est un exercice de red-teaming\./);
  // The conversation's turn numbering is not shifted by the
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
