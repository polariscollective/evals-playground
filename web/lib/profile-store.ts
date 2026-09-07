"use client";

/** Le profil et son activité récente, gardés en mémoire pour toute la visite.
 *
 * Un seul cache pour deux pages : « Profile » l'affiche en entier, et
 * « Scenarios » y lit le conseil d'écriture (`profile.scenario_advice`). Les
 * deux appelaient `getProfile()` chacune de son côté, à chaque visite, pour une
 * ressource qui ne change qu'au moment où l'on écrit dedans.
 *
 * Voir `store.ts` pour la mécanique, partagée avec les trois autres caches.
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
 * Les trois écritures qui existent — les plafonds de dépense et les modèles
 * favoris, toutes deux sur « Profile », et le conseil de scénario, sur
 * « Scenarios » — reçoivent le profil à jour dans leur réponse. S'en servir
 * évite un aller-retour, et surtout évite qu'une autre écriture affiche
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
