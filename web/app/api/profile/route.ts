import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { favoritesProblem } from "@/lib/favorite-models";
import { capProblem, profilePatchProblem } from "@/lib/profile-caps";
import {
  ensureProfile,
  updateFavoriteModels,
  updateProfileCaps,
  updateScenarioAdvice,
} from "@/lib/profiles";
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

/** Change les plafonds, le conseil d'écriture de scénario, ou les favoris de
 *  modèles — jamais deux de ces trois à la fois.
 *
 * L'email vient de la session, jamais du corps — comme pour une révocation de
 * connexion MCP : sans quoi n'importe quel compte connecté pourrait modifier
 * le profil d'un autre en devinant son adresse.
 *
 * Les trois réglages sont indépendants : la page de profil envoie les
 * plafonds ou les favoris, la page des scénarios envoie le conseil, et
 * aucune n'a à connaître les autres. Si une requête en porte deux, elle est
 * refusée plutôt que de dédouaner l'un d'eux en silence. `undefined` veut
 * dire « ne touche pas », et `null` veut dire « remets le défaut » — sauf
 * pour les favoris, qui n'acceptent jamais `null` : voir
 * `updateFavoriteModels`. */
export async function PATCH(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  // Un corps JSON valant littéralement `null` n'échoue pas à l'analyse — la
  // lecture réussit et rend `null` — donc `.catch` ne s'en charge pas. Sans le
  // `?? {}` qui suit, l'accès à un champ plus bas lèverait sur ce `null` et la
  // route répondrait 500 au lieu de simplement traiter un corps vide.
  const body = ((await request.json().catch(() => null)) ?? {}) as {
    max_usd_per_run?: unknown;
    max_usd_per_hour?: unknown;
    scenario_advice?: unknown;
    favorite_models?: unknown;
  };

  // Refuser une requête qui porte à la fois deux de ces trois réglages —
  // règle testée séparément dans profile-caps.test.mts, sur le même patron
  // que capProblem.
  const patchProblem = profilePatchProblem(body);
  if (patchProblem) {
    return NextResponse.json({ error: patchProblem }, { status: 422 });
  }

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

  if (body.favorite_models !== undefined) {
    const problem = favoritesProblem(body.favorite_models);
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
    const profile = await updateFavoriteModels(
      user.email,
      body.favorite_models as string[],
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
