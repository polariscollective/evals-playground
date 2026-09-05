import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { estimateCost } from "@/lib/pricing";
import { configProblem } from "@/lib/validate";
import type { EvalRunConfig } from "@/lib/types";

/** Estime le coût d'un run sans rien lancer.
 *
 * Même schéma d'entrée que le lancement : l'interface estime donc exactement ce
 * qu'elle s'apprête à envoyer, sans transformation intermédiaire susceptible de
 * diverger. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const config = (await request.json().catch(() => null)) as EvalRunConfig | null;

  const problem = configProblem(config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  // La longueur supposée est dans la config, comme le reste : un paramètre de
  // requête à côté permettait d'estimer autre chose que ce qu'on s'apprêtait à
  // lancer.
  return NextResponse.json(estimateCost(config!));
}
