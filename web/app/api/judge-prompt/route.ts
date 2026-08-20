import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { JUDGE_SYSTEM, renderTranscript, scorePrompt } from "@/lib/judge-prompt";
import type { RubricLevel } from "@/lib/types";

/** Rend visible le prompt que le juge recevra, avant de lancer un run.
 *
 * Rendu depuis le même gabarit que le Python qui l'envoie réellement : c'est la
 * seule façon que l'aperçu ne finisse pas par décrire un prompt qui n'existe
 * plus. Volontairement tolérant sur une échelle incomplète — on aperçoit pendant
 * qu'on écrit, pas seulement quand tout est valide. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => ({}))) as {
    criterion?: string;
    rubric?: RubricLevel[];
  };

  const transcript = renderTranscript([
    { role: "user", content: "…the conversation being judged…" },
    { role: "assistant", content: "…the evaluated model's reply…" },
  ]);

  return NextResponse.json({
    system_message: JUDGE_SYSTEM,
    user_message: scorePrompt(
      transcript,
      body.criterion ?? "",
      (body.rubric ?? []).filter((level) => Number.isFinite(level?.value)),
    ),
  });
}
