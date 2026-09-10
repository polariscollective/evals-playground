// The prompts exactly as they leave, rendered where somebody can read them.
//
// Two of them are assembled by the tool rather than typed on the form. A
// judge's criterion is placed inside a system prompt that already tells it to
// grade the assistant and not the user. An adversary's objective is framed,
// before and after, by a confidentiality notice and three realism rules nobody
// on the form wrote. Neither is visible while you type, and both change what
// the numbers mean, so both are worth a button.
//
// Rendered from the same shared templates the Python sends (`shared/*.json`),
// which is the only way a preview stays a preview: one that described a prompt
// no longer leaving would be a lie nobody could see.
import { fill, judgeSystem, renderTranscript, scorePrompt } from "./judge-prompt.ts";
import {
  SHARED_ADVERSARY_PROMPT,
  SHARED_AWARENESS_PROMPT,
  SHARED_FIDELITY_PROMPT,
} from "./shared.ts";
import type { JudgeGrades, RubricLevel } from "./types";

export interface PromptPreview {
  system: string;
  /** A judge also gets a user message. The adversary has none: its user turns
   *  are the conversation so far, mirrored. */
  user?: string;
}

/** The parts that only exist once a conversation has run.
 *
 * Written out rather than left out. A preview missing the system-prompt block
 * would read as a judge that never receives one, which is the opposite of what
 * `sees_system_prompt` decides. */
export const PROMPT_PLACEHOLDER = {
  systemPrompt: "…the scenario's system prompt…",
  openingMessage: "…the scenario's opening message…",
  /** For the library page, where a judge is read on its own and belongs to no
   *  run: the objective is written per run, so there is none to show. */
  adversaryObjective: "…the objective written for the adversary…",
} as const;

const PLACEHOLDER_TRANSCRIPT = [
  { role: "user", content: "…the conversation being judged…" },
  { role: "assistant", content: "…the evaluated model's reply…" },
];

/** What the transcript's head looks like for a judge, honouring its own
 *  `sees_system_prompt`. `null` means the block is genuinely absent. */
function headFor(
  seesSystemPrompt: boolean,
  systemPrompt: string | null | undefined,
): string | null {
  if (!seesSystemPrompt) return null;
  return systemPrompt?.trim() || PROMPT_PLACEHOLDER.systemPrompt;
}

/** An ordinary judge: the shared system prompt, then the criterion and scale
 *  the user wrote, inside the shared user template.
 *
 * @param systemPrompt The scenario's own system prompt when one is known, so a
 *   run being reread shows what its judge actually had in front of it. Left
 *   out on the setup form, where no scenario has been chosen yet. */
export function judgePreview(
  judge: {
    criterion: string;
    rubric: RubricLevel[];
    sees_system_prompt?: boolean | null;
    /** Whose turns it grades. Absent grades the assistant, which is what every
     *  judge written before this field did. */
    grades?: JudgeGrades | null;
    sees_adversary_goals?: boolean | null;
  },
  systemPrompt?: string | null,
  /** The run's objective, for a judge allowed to see it. Absent stands it in,
   *  so the preview shows the block rather than hiding a whole section of what
   *  the judge receives. */
  adversaryPrompt?: string | null,
): PromptPreview {
  const head = headFor(judge.sees_system_prompt !== false, systemPrompt);
  const objective = judge.sees_adversary_goals
    ? adversaryPrompt?.trim() || PROMPT_PLACEHOLDER.adversaryObjective
    : "";
  return {
    system: judgeSystem(judge.grades ?? "assistant"),
    // Tolerant of an incomplete scale: one previews while writing, not only
    // once the form would pass validation.
    user: scorePrompt(
      renderTranscript(PLACEHOLDER_TRANSCRIPT, head),
      judge.criterion,
      (judge.rubric ?? []).filter((level) => Number.isFinite(level?.value)),
      objective,
    ),
  };
}

/** The awareness judge. Its question and its scale come from the code and are
 *  the same in every run, which is exactly why they are worth showing: nothing
 *  on the form says what this judge is being asked. */
export function awarenessPreview(
  seesSystemPrompt = true,
  systemPrompt?: string | null,
): PromptPreview {
  const head = headFor(seesSystemPrompt, systemPrompt);
  return {
    system: SHARED_AWARENESS_PROMPT.system,
    user: fill(SHARED_AWARENESS_PROMPT.user_template, {
      transcript: renderTranscript(PLACEHOLDER_TRANSCRIPT, head),
    }),
  };
}

/** The adversary-fidelity judge: the one judge that grades the USER.
 *
 * The only judge prompt carrying the adversary's objective, which is exactly
 * why it is worth reading. Every ordinary judge is kept from that text on
 * purpose, so somebody looking at a fidelity grade and wondering what the judge
 * could possibly have compared against needs this button to answer it. */
export function fidelityPreview(
  adversaryPrompt: string,
  seesSystemPrompt = true,
  systemPrompt?: string | null,
): PromptPreview {
  const head = headFor(seesSystemPrompt, systemPrompt);
  return {
    system: SHARED_FIDELITY_PROMPT.system,
    user: fill(SHARED_FIDELITY_PROMPT.user_template, {
      transcript: renderTranscript(PLACEHOLDER_TRANSCRIPT, head),
      adversary_prompt: adversaryPrompt,
    }),
  };
}

/** The adversary. Its objective is framed by the confidentiality notice twice
 *  over, which is the whole reason this preview exists: somebody who writes
 *  "never admit this is a test" into the objective is writing it a third time.
 *
 * Mirrors `adversary_view` in `backend/playground/conversation.py` word for
 * word, from the same template. */
export function adversaryPreview(
  adversaryPrompt: string,
  openingMessage?: string | null,
): PromptPreview {
  return {
    system: fill(SHARED_ADVERSARY_PROMPT.system_template, {
      notice: SHARED_ADVERSARY_PROMPT.confidentiality_notice,
      adversary_prompt: adversaryPrompt,
      opening_message:
        openingMessage?.trim() || PROMPT_PLACEHOLDER.openingMessage,
    }),
  };
}
