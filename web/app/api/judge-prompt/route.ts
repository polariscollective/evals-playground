import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { JUDGE_SYSTEM, renderTranscript, scorePrompt } from "@/lib/judge-prompt";
import type { RubricLevel } from "@/lib/types";

/** Rend visible le prompt que le juge recevra, avant de lancer un run.
 *
 * Rendu depuis le même gabarit que le Python qui l'envoie réellement : c'est la
 * seule façon que l'aperçu ne finisse pas par décrire un prompt qui n'existe
 * plus. Volontairement tolérant sur une échelle incomplète — on aperçoit pendant
 * qu'on écrit, pas seulement quand tout est valide.
 *
 * Le juge reçoit aussi le system prompt du scénario joué, en tête du
 * transcript — voir `renderTranscript`. Cette route ne connaît qu'un critère
 * et une échelle, communs à tout le run : elle ne sait pas, à cet endroit du
 * formulaire, de quel scénario elle devrait montrer le system prompt, ni s'il
 * y en a un seul (le mode CSV en admet plusieurs). L'aperçu illustre donc le
 * bloc par un texte de remplacement plutôt que de l'omettre, ce qui laisserait
 * croire que le juge ne le reçoit pas. */
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
