"use client";

/** Le socle des caches de navigation : runs, tags, profil, connexions.
 *
 * Tous gardent en mémoire, pour toute la visite, ce qu'un aller-retour entre
 * onglets rechargeait sinon à chaque fois. Ils ont la même mécanique — un état
 * de module, des abonnés, un instantané stable — et c'est elle qui est ici
 * plutôt que recopiée quatre fois. `createResource` en dessous en fait un
 * cache complet à partir d'une seule fonction de lecture.
 *
 * Le point délicat est la stabilité de l'instantané. `useSyncExternalStore`
 * compare par identité : rendre un objet neuf à chaque écriture suffirait à
 * faire re-rendre la page, même avec des données identiques. D'où la
 * comparaison de surface dans `set`, qui ne prévient personne quand rien n'a
 * bougé — et d'où `keepIfUnchanged` chez les appelants, qui garde la référence
 * précédente quand une réponse répète la précédente.
 *
 * En mémoire seulement : un rechargement complet repart de zéro. C'est voulu —
 * rien à invalider, rien à versionner, et jamais des données d'hier affichées
 * comme si elles étaient fraîches.
 */

import { keepIfUnchanged } from "./unchanged";

export interface Store<T extends object> {
  get(): T;
  /** L'état de départ, rendu tel quel côté serveur. Une référence constante,
   *  sans quoi React signale un instantané serveur qui change à chaque rendu. */
  getInitial(): T;
  /** Fusionne, et ne prévient que si quelque chose a changé. */
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

/** Ce qu'un cache de navigation porte, quelle que soit la ressource. */
export interface ResourceState<T> {
  /** `null` tant qu'aucune réponse n'est arrivée : c'est ce qui distingue
   *  « pas encore chargé » de « chargé, et il n'y a rien ». */
  data: T | null;
  /** Un chargement dont l'écran doit rendre compte. Faux pendant les
   *  rafraîchissements silencieux, qui ne doivent rien faire clignoter. */
  loading: boolean;
  error: string | null;
}

export interface Resource<T> {
  refresh(options?: { silent?: boolean }): Promise<void>;
  /** Charge si ça ne l'a jamais été. Ce qu'appellent les préchargements. */
  ensureLoaded(): void;
  /** Écrit à la main, sans aller-retour — après une suppression, par exemple. */
  set(data: T): void;
  get(): ResourceState<T>;
  getInitial(): ResourceState<T>;
  subscribe(listener: () => void): () => void;
}

/** Une ressource lue une fois, gardée en mémoire, revérifiée à chaque visite.
 *
 * Le motif est le même pour les runs, les tags, le profil et les connexions :
 * on arrive sur une page, on montre ce qu'on avait déjà, et on revérifie
 * derrière. Presque rien ne change entre deux clics, et attendre une réponse
 * réseau pour afficher ce qu'on vient de lire donne l'impression que
 * l'application recharge tout à chaque fois.
 *
 * `silent` sépare les deux raisons de rafraîchir. Un sondage de fond remplace
 * les données si elles ont bougé, et se tait sinon. Une arrivée sur la page
 * allume l'indicateur — on veut savoir que ce qu'on lit est en cours de
 * vérification, par-dessus les données déjà affichées.
 *
 * Le crochet n'est pas rendu ici : `useSyncExternalStore` est appelé par chaque
 * module, qui en tire un `useX()` correctement nommé. Un `resource.use()` ne
 * serait pas reconnu comme un crochet par les règles de lint de React. */
export function createResource<T>(fetcher: () => Promise<T>): Resource<T> {
  const store = createStore<ResourceState<T>>({
    data: null,
    loading: false,
    error: null,
  });
  const flight = single();
  let fetchedAt: number | null = null;

  function refresh(options: { silent?: boolean } = {}): Promise<void> {
    // Si un appel est déjà en vol, `run` rend sa promesse et ce corps ne
    // s'exécute pas : on n'allume pas l'indicateur pour une requête que
    // quelqu'un d'autre a déjà lancée.
    return flight.run(async () => {
      if (!options.silent) store.set({ loading: true });
      try {
        const fetched = await fetcher();
        fetchedAt = Date.now();
        // Une réponse identique garde la référence précédente, et rien ne se
        // redessine.
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

  // Une fonction nommée plutôt qu'une méthode : `ensureLoaded` est passée
  // telle quelle dans les effets des pages, où un `this` se perdrait.
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

/** Enveloppe une requête pour qu'un seul appel soit en vol à la fois.
 *
 * Deux pages montées coup sur coup, ou un sondage qui croise une visite, ne
 * doivent pas lancer deux fois la même chose. Rend la promesse déjà en cours
 * le cas échéant, et se libère quoi qu'il arrive. */
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
