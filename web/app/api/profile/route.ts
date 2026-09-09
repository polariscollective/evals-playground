import { ADVICE_TOPICS, isAdviceTopic } from "@/lib/advice";
import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { favoritesProblem } from "@/lib/favorite-models";
import { capProblem, profilePatchProblem } from "@/lib/profile-caps";
import {
  ensureProfile,
  updateFavoriteModels,
  updateProfileCaps,
  updateAdvice,
} from "@/lib/profiles";
import { mcpActivityLastHour } from "@/lib/runs";

/** The profile of whoever is looking, and the rolling hour of `mcp_launches`
 *  for them — the two do not live in the same table, but the profile page only
 *  needs to read them together. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const [profile, activity] = await Promise.all([
    ensureProfile(user.email),
    mcpActivityLastHour(user.email),
  ]);
  return NextResponse.json({ profile, activity });
}

/** Changes the caps, the scenario writing advice, or the model favourites —
 *  never two of those three at once.
 *
 * The email comes from the session, never from the body — as for an MCP
 * connection revocation: without which any signed-in account could change
 * somebody else's profile by guessing their address.
 *
 * The three settings are independent: the profile page sends the caps or the
 * favourites, the scenarios page sends the advice, and neither has to know about
 * the others. If a request carries two of them, it is refused rather than
 * clearing one of them in silence. `undefined` means "do not touch", and `null`
 * means "restore the default" — except for the favourites, which never accept
 * `null`: see `updateFavoriteModels`. */
export async function PATCH(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  // A JSON body worth literally `null` does not fail parsing — the read succeeds
  // and returns `null` — so `.catch` does not deal with it. Without the `?? {}`
  // that follows, accessing a field below would raise on that `null` and the
  // route would answer 500 instead of simply treating an empty body.
  const body = ((await request.json().catch(() => null)) ?? {}) as {
    max_usd_per_run?: unknown;
    max_usd_per_hour?: unknown;
    scenario_advice?: unknown;
    /** Lequel des quatre documents `scenario_advice` porte. Absent vaut
     *  `"scenario"` — la forme d'avant que le conseil ne se coupe en quatre,
     *  qu'un client déjà déployé envoie encore. */
    advice_topic?: unknown;
    favorite_models?: unknown;
  };

  // Refuse a request that carries two of those three settings at once — a rule
  // tested separately in profile-caps.test.mts, on the same pattern as
  // capProblem.
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
    const topic = body.advice_topic ?? "scenario";
    if (!isAdviceTopic(topic)) {
      return NextResponse.json(
        {
          error:
            `advice_topic must be one of ${ADVICE_TOPICS.join(", ")}`,
        },
        { status: 422 },
      );
    }
    const profile = await updateAdvice(
      user.email,
      topic,
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
