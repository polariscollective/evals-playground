import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { JUDGE_SYSTEM, renderTranscript, scorePrompt } from "@/lib/judge-prompt";
import type { RubricLevel } from "@/lib/types";

/** Makes visible the prompt the judge will receive, before launching a run.
 *
 * Rendered from the same template as the Python that really sends it: the only
 * way for the preview not to end up describing a prompt that no longer exists.
 * Deliberately tolerant of an incomplete scale — one previews while writing, not
 * only once everything is valid.
 *
 * The judge also receives the played scenario's system prompt, at the head of
 * the transcript — see `renderTranscript`. This route knows only a criterion and
 * a scale, common to the whole run: it does not know, at that point in the form,
 * which scenario's system prompt it should be showing, nor whether there is a
 * single one (CSV mode admits several). The preview therefore illustrates the
 * block with placeholder text rather than omitting it, which would suggest the
 * judge does not receive it. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => ({}))) as {
    criterion?: string;
    rubric?: RubricLevel[];
  };

  const transcript = renderTranscript(
    [
      { role: "user", content: "…the conversation being judged…" },
      { role: "assistant", content: "…the evaluated model's reply…" },
    ],
    "…the evaluated model's system prompt…",
  );

  return NextResponse.json({
    system_message: JUDGE_SYSTEM,
    user_message: scorePrompt(
      transcript,
      body.criterion ?? "",
      (body.rubric ?? []).filter((level) => Number.isFinite(level?.value)),
    ),
  });
}
