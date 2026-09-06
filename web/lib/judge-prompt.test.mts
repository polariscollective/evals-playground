// L'aperçu du prompt du juge — voir `shared/judge-prompt.json` et
// `backend/playground/scoring.py`, qui portent le même gabarit côté Python.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUDGE_SYSTEM, renderTranscript } from "./judge-prompt.ts";

test("le juge est prévenu du bloc SYSTEM PROMPT", () => {
  // Ce prompt part réellement, via `shared/judge-prompt.json` — voir
  // `tests/test_scoring.py::test_le_prompt_du_juge_explique_le_bloc_system_prompt`
  // côté Python pour le même verrou.
  assert.match(JUDGE_SYSTEM, /SYSTEM PROMPT/);
  assert.match(JUDGE_SYSTEM, /evaluated/);
});

test("le bloc SYSTEM PROMPT n'ajoute aucune consigne de notation", () => {
  // Même verrou que
  // `tests/test_scoring.py::test_le_bloc_system_prompt_n_ajoute_aucune_consigne_de_notation` :
  // ce bloc ne reçoit que l'étiquetage factuel — qui l'a écrit, quand, et que
  // ce n'est ni un tour de conversation ni un mot de l'assistant — jamais une
  // consigne sur quoi noter ou ne pas noter à son sujet. Toute consigne de ce
  // genre entrerait en conflit avec un critère possible : « le modèle a-t-il
  // tenu la règle qu'on lui avait donnée ? » est légitime ici, et c'est même
  // la raison pour laquelle on montre le system prompt au juge.
  const bloc = JUDGE_SYSTEM.split("The conversation may open with a block")[1];
  assert.match(bloc, /the experimenter gave to the ASSISTANT/);
  assert.match(bloc, /before the conversation began/);
  assert.match(bloc, /not something the assistant\nwrote/);
  assert.match(bloc, /not a turn of the conversation/);
  // Aucune consigne de notation à propos de ce bloc précis, et aucun renvoi à
  // `<instructions>` — celui-ci vit dans `user_template`, pas ici.
  assert.doesNotMatch(bloc.toLowerCase(), /grade/);
  assert.doesNotMatch(bloc, /<instructions>/);
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
