"use client";

/** L'état des filtres de chaque liste, partagé par la page et gardé d'une
 *  visite à l'autre.
 *
 * Un magasin plutôt qu'un `useState` pour une raison précise : la valeur vit
 * dans `localStorage`, que le serveur ne connaît pas. La lire au premier rendu
 * ferait diverger le HTML rendu côté serveur de celui rendu côté client.
 * `useSyncExternalStore` traite ce cas nommément — il rend l'instantané
 * serveur pendant l'hydratation, puis rebascule sur le vrai — là où un effet
 * qui poserait l'état après coup vaudrait un rendu de plus et un
 * avertissement de React.
 */

import { useSyncExternalStore } from "react";
import {
  defaultState,
  readState,
  writeState,
  type FilterMode,
} from "./filter-storage";
import { createStore } from "./store";
import {
  OPEN,
  cycleDimension,
  toggleOff,
  type DimensionKey,
  type FilterState,
} from "./run-filters";

/** Des références constantes : `useSyncExternalStore` compare les instantanés
 *  par identité, et un objet neuf à chaque appel ferait boucler le rendu. */
const SERVER: Record<FilterMode, { state: FilterState }> = {
  runs: { state: defaultState("runs") },
  drafts: { state: defaultState("drafts") },
};

const stores = {
  runs: createStore(SERVER.runs),
  drafts: createStore(SERVER.drafts),
};

/** `localStorage` n'est lu qu'une fois par liste, à la première demande. */
const loaded: Record<FilterMode, boolean> = { runs: false, drafts: false };

function snapshot(mode: FilterMode): { state: FilterState } {
  if (!loaded[mode]) {
    loaded[mode] = true;
    stores[mode].set({ state: readState(mode) });
  }
  return stores[mode].get();
}

function commit(mode: FilterMode, next: FilterState): void {
  stores[mode].set({ state: next });
  writeState(mode, next);
}

/** Fait tourner un bouton de dimension : un côté, l'autre, les deux. */
export function cycleDim(mode: FilterMode, key: DimensionKey): void {
  commit(mode, cycleDimension(stores[mode].get().state, key));
}

/** Tout montrer : aucune dimension réduite, aucun tag éteint.
 *
 * Distinct du geste ci-dessous, et c'est la distinction qui compte. « Tout
 * montrer » et « revenir aux réglages de départ » ne donnent pas le même
 * écran : les défauts masquent délibérément les runs d'agent et les brouillons
 * déjà lancés. Un seul bouton pour les deux aurait fait passer un choix pour
 * une absence de choix. */
export function clearFilters(mode: FilterMode): void {
  commit(mode, OPEN);
}

/** Revenir aux réglages de départ — ceux que la page choisit d'appliquer à la
 *  première visite. */
export function defaultFilters(mode: FilterMode): void {
  commit(mode, defaultState(mode));
}

/** Allume ou éteint un tag, ou un statut. */
export function toggleTag(mode: FilterMode, label: string): void {
  commit(mode, toggleOff(stores[mode].get().state, label));
}

export function useFilterState(mode: FilterMode): FilterState {
  return useSyncExternalStore(
    stores[mode].subscribe,
    () => snapshot(mode),
    () => SERVER[mode],
  ).state;
}
