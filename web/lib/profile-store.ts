"use client";

/** The profile and its recent activity, kept in memory for the whole visit.
 *
 * Un seul cache pour deux pages : « Profile » l'affiche en entier, et
 * "Scenarios" reads the writing advice from it (`profile.scenario_advice`).
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

/** Écrit le profil rendu par une sauvegarde, sans relire.
 *
 * The three writes that exist — the spending caps and the favourite models,
 * both on "Profile", and the scenario advice, on "Scenarios" — receive the
 * up-to-date profile in their response. Using it avoids a round trip, and above
 * all avoids another write showing
 * encore l'ancienne version au prochain clic. */
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
