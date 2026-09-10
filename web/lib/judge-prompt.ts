// The judge prompt, rendered from the same template as the Python that
// actually sends it — see `shared/judge-prompt.json`. A preview describing a
// prompt that is no longer the one that leaves would be a lie nobody would see.
import { SHARED_JUDGE_PROMPT } from "./shared.ts";
import type { JudgeGrades, RubricLevel } from "./types";

/** The system message an ordinary judge receives, for whose turns it grades.
 *
 * A head plus a shared tail. The head says who is being graded; the tail
 * carries the rules that hold whoever it is — the seeded turns, the tool turns,
 * the system prompt block. Three copies of that tail would drift, and it is the
 * half where drifting changes grades.
 *
 * Mirrors `judge_system` (`backend/playground/scoring.py`), which is what
 * really sends it. */
export function judgeSystem(grades: JudgeGrades = "assistant"): string {
  const heads = SHARED_JUDGE_PROMPT.system_head_by_grades;
  const head = heads[grades] ?? heads.assistant;
  return `${head}\n\n${SHARED_JUDGE_PROMPT.system_tail}`;
}

/** The ordinary case, kept as a name because most callers grade the
 *  assistant. */
export const JUDGE_SYSTEM = judgeSystem();

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

/** The user message.
 *
 * `adversaryPrompt` is prepended as its own named block, and only for a judge
 * whose `sees_adversary_goals` is on: the caller decides that, never this
 * function. Empty means the block is absent rather than present and blank — an
 * empty `<objective>` reads as "there was no objective", which is not the same
 * as "you were not shown it". */
export function scorePrompt(
  transcriptText: string,
  criterion: string,
  rubric: RubricLevel[],
  adversaryPrompt = "",
): string {
  const objective = adversaryPrompt
    ? fill(SHARED_JUDGE_PROMPT.objective_block, {
        adversary_prompt: adversaryPrompt,
      })
    : "";
  return objective + fill(SHARED_JUDGE_PROMPT.user_template, {
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
