import { NextResponse } from "next/server";
import { estimateCost } from "@/lib/pricing";
import { configProblem } from "@/lib/validate";
import type { EvalRunConfig } from "@/lib/types";

/** Estime le coût d'un run sans rien lancer.
 *
 * Même schéma d'entrée que le lancement : l'interface estime donc exactement ce
 * qu'elle s'apprête à envoyer, sans transformation intermédiaire susceptible de
 * diverger. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("response_tokens");
  const config = (await request.json().catch(() => null)) as EvalRunConfig | null;

  const problem = configProblem(config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  return NextResponse.json(
    estimateCost(config!, raw === null ? null : Number(raw)),
  );
}
