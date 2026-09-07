"use client";

/** Les connecteurs MCP autorisés, gardés en mémoire pour toute la visite.
 *
 * Même motif que les autres caches : la page repartait d'une zone vide et d'une
 * requête à chaque visite, pour une liste qui ne bouge qu'au moment où l'on
 * connecte ou révoque quelque chose.
 *
 * Voir `store.ts` pour la mécanique, partagée avec les trois autres caches.
 */

import { useSyncExternalStore } from "react";
import { listMcpConnections, type McpGrant } from "./api";
import { createResource } from "./store";

const connections = createResource<McpGrant[]>(listMcpConnections);

export const refreshConnections = connections.refresh;
export const ensureConnectionsLoaded = connections.ensureLoaded;

export function useConnections(): {
  grants: McpGrant[] | null;
  loading: boolean;
  error: string | null;
} {
  const state = useSyncExternalStore(
    connections.subscribe,
    connections.get,
    connections.getInitial,
  );
  return { grants: state.data, loading: state.loading, error: state.error };
}
