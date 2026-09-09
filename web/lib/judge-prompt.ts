// The judge prompt, rendered from the same template as the Python that
// actually sends it — see `shared/judge-prompt.json`. A preview describing a
// prompt that is no longer the one that leaves would be a lie nobody would see.
import { SHARED_JUDGE_PROMPT } from "./shared.ts";
import type { RubricLevel } from "./types";

export const JUDGE_SYSTEM = SHARED_JUDGE_PROMPT.system;

/** The grade as it is written to the judge and on screen.
 *
 * A whole number stays a whole number: `2`, not `2.0`. Scales are written by
 * hand, often in round numbers, and a stray decimal in the prompt invites the
 * judge to answer something other than what it was offered. */
export function formatValue(value: number): string {
  return String(value);
}

/** The scale sorted from lowest grade to highest.
 *
 * A scale presented out of order reads as a list of options with no
 * progression, when the order is precisely what makes it a scale. */
export function sortedRubric(rubric: RubricLevel[]): RubricLevel[] {
  return [...rubric].sort((a, b) => a.value - b.value);
}

export function renderRubric(rubric: RubricLevel[]): string {
  return sortedRubric(rubric)
    .map((level) =>
      fill(SHARED_JUDGE_PROMPT.rubric_line, {
        value: formatValue(level.value),
        meaning: level.meaning,
      }),
    )
    .join("\n");
}

/** Replaces a template's slots, without interpreting the replacement.
 *
 * `String.replace` treats `$&`, `$1` and their like as patterns in the
 * replacement string: a criterion containing `$&` would have its text
 * corrupted. A replacement function escapes that rule. */
export function fill(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [name, value] of Object.entries(values)) {
    out = out.replaceAll(`{${name}}`, () => value);
  }
  return out;
}

/** Lays the transcript out for the judge, turns numbered.
 *
 * The numbering lets the judge cite a particular turn, which makes its grade
 * checkable without rereading the whole conversation.
 *
 * @param systemPrompt The system prompt of the scenario played, to precede the
 *   transcript — the same mechanism as `render_transcript` on the Python side
 *   (`backend/playground/scoring.py`). Rendered outside the turn numbering, but
 *   marked `given as context` like a seeded turn: it is not a turn of the
 *   conversation, and neither is it a word from the evaluated model. Absent,
 *   the rendering does not change — which is the case for this preview, tied to
 *   no real scenario. */
export function renderTranscript(
  messages: { role: string; content: string }[],
  systemPrompt?: string | null,
): string {
  const lines: string[] = [];
  if (systemPrompt) {
    lines.push(`SYSTEM PROMPT, given as context: ${systemPrompt}`);
  }
  messages.forEach((message, index) => {
    const speaker =
      message.role === "user"
        ? "USER"
        : message.role === "assistant"
          ? "ASSISTANT"
          : message.role.toUpperCase();
    lines.push(`${speaker} [turn ${index + 1}]: ${message.content}`);
  });
  return lines.join("\n\n");
}

export function scorePrompt(
  transcriptText: string,
  criterion: string,
  rubric: RubricLevel[],
): string {
  return fill(SHARED_JUDGE_PROMPT.user_template, {
    criterion,
    transcript: transcriptText,
    rubric: renderRubric(rubric),
    values: sortedRubric(rubric)
      .map((level) =>
        fill(SHARED_JUDGE_PROMPT.value_template, {
          value: formatValue(level.value),
        }),
      )
      .join(SHARED_JUDGE_PROMPT.value_separator),
  });
}
