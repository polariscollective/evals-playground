"use client";

/** The authorised MCP connectors, kept in memory for the whole visit.
 *
 * The same pattern as the other caches: the page started from an empty area
 * and a request at every visit, for a list that only moves when something is
 * connected or revoked.
 *
 * See `store.ts` for the mechanism, shared with the three other caches.
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
