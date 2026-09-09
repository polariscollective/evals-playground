// The judge prompt preview — see `shared/judge-prompt.json` and
// `backend/playground/scoring.py`, which carry the same template on the Python
// side.
import { test } from "node:test";
import assert from "node:assert/strict";
import { JUDGE_SYSTEM, renderTranscript } from "./judge-prompt.ts";

test("the judge is warned about the SYSTEM PROMPT block", () => {
  // This prompt really goes out, through `shared/judge-prompt.json` — see
  // `tests/test_scoring.py::test_the_judge_prompt_explains_the_system_prompt_block`
  // on the Python side for the same lock.
  assert.match(JUDGE_SYSTEM, /SYSTEM PROMPT/);
  assert.match(JUDGE_SYSTEM, /evaluated/);
});

test("the SYSTEM PROMPT block adds no grading instruction", () => {
  // The same lock as
  // `tests/test_scoring.py::test_the_system_prompt_block_adds_no_grading_instruction`:
  // this block receives factual labelling only — who wrote it, when, and that it
  // is neither a turn of the conversation nor a word from the assistant — never
  // an instruction about what to grade or not to grade concerning it. Any such
  // instruction would conflict with a possible criterion: "did the model hold
  // to the rule it was given?" is legitimate here, and is in fact the reason the
  // system prompt is shown to the judge.
  const block = JUDGE_SYSTEM.split("The conversation may open with a block")[1];
  assert.match(block, /the experimenter gave to the ASSISTANT/);
  assert.match(block, /before the conversation began/);
  assert.match(block, /not something the assistant\nwrote/);
  assert.match(block, /not a turn of the conversation/);
  // No grading instruction about this particular block, and no reference to
  // `<instructions>` — that one lives in `user_template`, not here.
  assert.doesNotMatch(block.toLowerCase(), /grade/);
  assert.doesNotMatch(block, /<instructions>/);
});

test("the system prompt is rendered first, marked given as context", () => {
  const rendered = renderTranscript(
    [{ role: "assistant", content: "I know this is a test." }],
    "This is a red-teaming exercise.",
  );
  assert.match(rendered, /SYSTEM PROMPT, given as context: This is a red-teaming exercise\./);
  // The conversation's turn numbering is not shifted by the system prompt, which
  // is not one.
  assert.match(rendered, /ASSISTANT \[turn 1\]:/);
});

test("with no system prompt, the rendering does not change", () => {
  const messages = [
    { role: "user", content: "a" },
    { role: "assistant", content: "b" },
  ];
  assert.equal(renderTranscript(messages), renderTranscript(messages, undefined));
  assert.equal(renderTranscript(messages), "USER [turn 1]: a\n\nASSISTANT [turn 2]: b");
  assert.doesNotMatch(renderTranscript(messages), /SYSTEM PROMPT/);
});
