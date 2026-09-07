"use client";

/** La liste des runs, gardée en mémoire pour toute la visite.
 *
 * Sans ça, chaque passage sur l'onglet « Runs » repartait d'un écran vide et
 * d'une requête : on arrivait sur « Evaluate », on cliquait sur « Runs », et on
 * attendait devant « Loading… » une liste qu'on avait déjà vue dix secondes
 * plus tôt. Le contenu ne bouge pourtant presque jamais entre deux clics.
 *
 * Un magasin de module plutôt qu'un contexte React : la page des runs n'est pas
 * la seule à déclencher le chargement — « Evaluate » le précharge en arrivant,
 * pour que l'onglet d'à côté soit déjà rempli quand on l'ouvre. Un contexte
 * aurait imposé un fournisseur dans `layout.tsx` pour un état que personne ne
 * modifie hors d'ici.
 *
 * La mécanique est dans `store.ts`, partagée avec les trois autres caches.
 */

import { useSyncExternalStore } from "react";
import { getRuns } from "./api";
import { createResource } from "./store";
import type { RunListItem } from "./types";

const runs = createResource(getRuns);

export const refreshRuns = runs.refresh;
export const ensureRunsLoaded = runs.ensureLoaded;

/** Retire un run du cache après sa mise à la corbeille, sans aller-retour.
 *  Sans ça, la ligne effacée réapparaîtrait au premier retour sur l'onglet. */
export function forgetRun(runId: string): void {
  const current = runs.get().data;
  if (current === null) return;
  runs.set(current.filter((entry) => entry.run.id !== runId));
}

export function useRuns(): {
  runs: RunListItem[] | null;
  loading: boolean;
  error: string | null;
} {
  const state = useSyncExternalStore(runs.subscribe, runs.get, runs.getInitial);
  return { runs: state.data, loading: state.loading, error: state.error };
}
