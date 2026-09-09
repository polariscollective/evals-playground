import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { catalog } from "@/lib/catalog";
import { favoriteModels } from "@/lib/favorite-models";
import { ensureProfile } from "@/lib/profiles";

/** The whole catalogue, marked for whoever asks.
 *
 * Whole and not filtered: the screens need both lists — what they offer, and
 * what they show when a run already launched carries a model that has left the
 * favourites. Filtering here would force a second round trip to find the name of
 * a model one has in front of one's eyes.
 *
 * An unreadable profile does not make the route fail: `favoriteModels(null)`
 * returns the code's default. Not knowing who is looking is no reason to offer
 * nothing. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const profile = await ensureProfile(user.email).catch(() => null);
  return NextResponse.json(catalog(favoriteModels(profile)));
}
