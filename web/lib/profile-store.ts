"use client";

/** The profile and its recent activity, kept in memory for the whole visit.
 *
 * One single cache for two pages: "Profile" shows it whole, and "Scenarios"
 * reads the writing advice from it (`profile.scenario_advice`).
 * The two each called `getProfile()` on their own side, at every visit, for a
 * resource that only changes when something is written into it.
 *
 * See `store.ts` for the mechanism, shared with the three other caches.
 */

import { useSyncExternalStore } from "react";
import { getProfile } from "./api";
import { createResource } from "./store";
import type { Profile, ProfileActivity } from "./types";

export interface ProfileData {
  profile: Profile;
  activity: ProfileActivity;
}

const profile = createResource<ProfileData>(getProfile);

export const refreshProfile = profile.refresh;
export const ensureProfileLoaded = profile.ensureLoaded;

/** Writes the profile a save returned, without rereading.
 *
 * The three writes that exist — the spending caps and the favourite models,
 * both on "Profile", and the scenario advice, on "Scenarios" — receive the
 * up-to-date profile in their response. Using it avoids a round trip, and above
 * all avoids another screen still showing the old version at the next click. */
export function putProfile(next: ProfileData): void {
  profile.set(next);
}

export function useProfile(): {
  data: ProfileData | null;
  loading: boolean;
  error: string | null;
} {
  return useSyncExternalStore(profile.subscribe, profile.get, profile.getInitial);
}
