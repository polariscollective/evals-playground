import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { capProblem } from "@/lib/profile-caps";
import { ensureProfile, updateProfileCaps, updateScenarioAdvice } from "@/lib/profiles";
import { mcpActivityLastHour } from "@/lib/runs";

/** Le profil de qui regarde, et l'heure glissante d'`mcp_launches` pour elle
 *  — les deux ne vivent pas dans la même table, mais la page de profil n'a
 *  besoin que de les lire ensemble. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const [profile, activity] = await Promise.all([
    ensureProfile(user.email),
    mcpActivityLastHour(user.email),
  ]);
  return NextResponse.json({ profile, activity });
}

/** Change les plafonds, ou le conseil d'écriture de scénario, ou les deux.
 *
 * L'email vient de la session, jamais du corps — comme pour une révocation de
 * connexion MCP : sans quoi n'importe quel compte connecté pourrait modifier
 * le profil d'un autre en devinant son adresse.
 *
 * Les deux champs sont indépendants : la page de profil envoie les plafonds,
 * la page des scénarios envoie le conseil, et aucune n'a à connaître l'autre.
 * `undefined` veut donc dire « ne touche pas », là où `null` veut dire
 * « remets le défaut ». */
export async function PATCH(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => ({}))) as {
    max_usd_per_run?: unknown;
    max_usd_per_hour?: unknown;
    scenario_advice?: unknown;
  };

  if (body.scenario_advice !== undefined) {
    if (body.scenario_advice !== null && typeof body.scenario_advice !== "string") {
      return NextResponse.json(
        { error: "scenario_advice must be a string, or null to restore the default" },
        { status: 422 },
      );
    }
    const profile = await updateScenarioAdvice(
      user.email,
      body.scenario_advice as string | null,
    );
    return NextResponse.json({ profile });
  }

  const perRunProblem = capProblem(body.max_usd_per_run);
  if (perRunProblem) {
    return NextResponse.json(
      { error: `max_usd_per_run ${perRunProblem}` },
      { status: 422 },
    );
  }
  const perHourProblem = capProblem(body.max_usd_per_hour);
  if (perHourProblem) {
    return NextResponse.json(
      { error: `max_usd_per_hour ${perHourProblem}` },
      { status: 422 },
    );
  }

  const profile = await updateProfileCaps(user.email, {
    max_usd_per_run: body.max_usd_per_run as number,
    max_usd_per_hour: body.max_usd_per_hour as number,
  });
  return NextResponse.json({ profile });
}
