import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { capProblem } from "@/lib/profile-caps";
import { ensureProfile, updateProfileCaps } from "@/lib/profiles";
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

/** Change les deux plafonds. L'email vient de la session, jamais du corps —
 *  comme pour une révocation de connexion MCP : sans quoi n'importe quel
 *  compte connecté pourrait changer le plafond d'un autre en devinant son
 *  adresse. */
export async function PATCH(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => ({}))) as {
    max_usd_per_run?: unknown;
    max_usd_per_hour?: unknown;
  };

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
