"use client";

/** The base of the navigation caches: runs, tags, profile, connections.
 *
 * All of them keep in memory, for the whole visit, what a round trip between
 * tabs would otherwise reload every time. They have the same mechanism — a
 * module state, subscribers, a stable snapshot — and it is that mechanism which
 * lives here rather than being copied four times. `createResource` below turns
 * it into a complete cache from a single read function.
 *
 * The delicate point is the snapshot's stability. `useSyncExternalStore`
 * compares by identity: returning a fresh object on every write would be enough
 * to re-render the page, even with identical data. Hence the shallow comparison
 * in `set`, which warns nobody when nothing has moved — and hence
 * `keepIfUnchanged` in the callers, which keeps the previous reference when a
 * response repeats the one before.
 *
 * In memory only: a full reload starts from nothing. That is deliberate —
 * nothing to invalidate, nothing to version, and never yesterday's data shown
 * as if it were fresh.
 */

import { keepIfUnchanged } from "./unchanged";

export interface Store<T extends object> {
  get(): T;
  /** The starting state, returned as it stands on the server side. A constant
   *  reference, without which React reports a server snapshot that changes on
   *  every render. */
  getInitial(): T;
  /** Merges, and warns only if something has changed. */
  set(next: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    getInitial: () => initial,

    set(next: Partial<T>): void {
      const merged = { ...state, ...next };
      const changed = (Object.keys(merged) as (keyof T)[]).some(
        (key) => !Object.is(merged[key], state[key]),
      );
      if (!changed) return;
      state = merged;
      for (const listener of listeners) listener();
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** What a navigation cache carries, whatever the resource. */
export interface ResourceState<T> {
  /** `null` as long as no response has arrived: that is what distinguishes
   *  "not loaded yet" from "loaded, and there is nothing". */
  data: T | null;
  /** A load the screen must account for. False during the silent refreshes,
   *  which must make nothing flicker. */
  loading: boolean;
  error: string | null;
}

export interface Resource<T> {
  refresh(options?: { silent?: boolean }): Promise<void>;
  /** Loads if it never has been. What the preloads call. */
  ensureLoaded(): void;
  /** Written by hand, with no round trip — after a deletion, for example. */
  set(data: T): void;
  get(): ResourceState<T>;
  getInitial(): ResourceState<T>;
  subscribe(listener: () => void): () => void;
}

/** A resource read once, kept in memory, checked again on every visit.
 *
 * The pattern is the same for the runs, the tags, the profile and the
 * connections: one arrives on a page, one shows what one already had, and one
 * checks again behind. Almost nothing changes between two clicks, and waiting
 * for a network response to show what one has just read gives the impression
 * that the application reloads everything every time.
 *
 * `silent` separates the two reasons to refresh. A background poll replaces the
 * data if it has moved, and keeps quiet otherwise. An arrival on the page turns
 * the indicator on — one wants to know that what one is reading is being
 * checked, on top of the data already shown.
 *
 * The hook is not returned here: `useSyncExternalStore` is called by each
 * module, which draws a properly named `useX()` from it. A `resource.use()`
 * would not be recognised as a hook by React's lint rules. */
export function createResource<T>(fetcher: () => Promise<T>): Resource<T> {
  const store = createStore<ResourceState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const flight = single();
  let fetchedAt: number | null = null;

  function refresh(options: { silent?: boolean } = {}): Promise<void> {
    // If a call is already in flight, `run` returns its promise and this body
    // does not execute: we do not turn the indicator on for a request somebody
    // else has already started.
    return flight.run(async () => {
      if (!options.silent) store.set({ loading: true });
      try {
        const fetched = await fetcher();
        fetchedAt = Date.now();
        // An identical response keeps the previous reference, and nothing is
        // redrawn.
        store.set({
          data: keepIfUnchanged(store.get().data, fetched),
          error: null,
          loading: false,
        });
      } catch (error) {
        store.set({ error: (error as Error).message, loading: false });
      }
    });
  }

  // A named function rather than a method: `ensureLoaded` is passed as it
  // stands into the pages' effects, where a `this` would be lost.
  function ensureLoaded(): void {
    if (fetchedAt === null && !flight.busy()) void refresh({ silent: true });
  }

  return {
    get: store.get,
    getInitial: store.getInitial,
    subscribe: store.subscribe,
    set: (data: T) => store.set({ data }),
    refresh,
    ensureLoaded,
  };
}

/** Wraps a request so that only one call is in flight at a time.
 *
 * Two pages mounted one after the other, or a poll that crosses a visit, must
 * not start the same thing twice. Returns the promise already under way where
 * there is one, and frees itself whatever happens. */
export function single(): {
  run(work: () => Promise<void>): Promise<void>;
  busy(): boolean;
} {
  let inFlight: Promise<void> | null = null;
  return {
    run(work) {
      if (inFlight) return inFlight;
      inFlight = work().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    busy: () => inFlight !== null,
  };
}
