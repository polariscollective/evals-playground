"use client";

/** L'état des filtres, d'une visite à l'autre, et séparément par liste.
 *
 * Deux clés, parce que ce sont deux barres : les runs se filtrent par machine,
 * publication, auteur ; les brouillons par ce qui n'appartient qu'à eux. Un
 * seul état pour les deux ferait qu'une réduction posée sur les brouillons
 * survivrait au retour sur les runs, où elle ne veut rien dire.
 *
 * `localStorage` et non `sessionStorage` : c'est une préférence, pas un état
 * de navigation. Quelqu'un qui ne veut voir que ses runs d'agent le pense pour
 * de bon. Contrairement aux caches de `store.ts`, qui eux doivent repartir de
 * zéro pour ne jamais montrer des données d'hier.
 *
 * Les clés portent un suffixe de version : la forme enregistrée est passée
 * d'une liste de libellés éteints à un objet, et relire l'ancienne comme la
 * nouvelle aurait rendu un état vide sans que personne ne comprenne pourquoi.
 * Une clé neuve laisse l'ancienne mourir de sa belle mort.
 *
 * Toute lecture et toute écriture sont gardées : un navigateur en navigation
 * privée, ou réglé pour refuser le stockage de site, fait lever l'accès
 * lui-même. Une préférence perdue ne doit pas casser la page.
 */

import { DIMENSION_KEYS, OPEN, type DimensionKey, type FilterState, type Side } from "./run-filters";

export type FilterMode = "runs" | "drafts";

const KEYS: Record<FilterMode, string> = {
  runs: "evals-playground:runs-filter-v2",
  drafts: "evals-playground:drafts-filter-v2",
};

/** L'état de départ de chaque liste.
 *
 * Côté runs, `author: "b"` — seulement ce qu'un humain a lancé : les runs
 * d'agent sont nombreux et rarement ce qu'on vient chercher. Côté brouillons,
 * `launch: "b"` — seulement ce qui attend, la file étant faite pour ça. Un
 * brouillon d'agent, lui, est justement ce qu'on vient voir : l'auteur reste
 * ouvert de ce côté. */
const DEFAULTS: Record<FilterMode, FilterState> = {
  runs: { dims: { author: "b" }, off: [] },
  drafts: { dims: { launch: "b" }, off: [] },
};

export function defaultState(mode: FilterMode): FilterState {
  return DEFAULTS[mode];
}

/** Relit ce qui a été écrit, en se méfiant de tout : une valeur d'une version
 *  d'avant, ou tapée à la main, ne doit pas faire tomber la liste. */
function parse(raw: unknown, mode: FilterMode): FilterState {
  if (!raw || typeof raw !== "object") return DEFAULTS[mode];
  const source = raw as { dims?: unknown; off?: unknown };

  const dims: Partial<Record<DimensionKey, Side>> = {};
  if (source.dims && typeof source.dims === "object") {
    const given = source.dims as Record<string, unknown>;
    for (const key of DIMENSION_KEYS) {
      const side = given[key];
      if (side === "a" || side === "b") dims[key] = side;
    }
  }

  const off = Array.isArray(source.off)
    ? source.off.filter((entry): entry is string => typeof entry === "string")
    : [];

  return { dims, off };
}

export function readState(mode: FilterMode): FilterState {
  try {
    const raw = window.localStorage.getItem(KEYS[mode]);
    if (raw === null) return DEFAULTS[mode];
    return parse(JSON.parse(raw), mode);
  } catch {
    return DEFAULTS[mode];
  }
}

export function writeState(mode: FilterMode, state: FilterState): void {
  try {
    window.localStorage.setItem(KEYS[mode], JSON.stringify(state));
  } catch {
    // Le réglage ne survivra pas à la visite. C'est tout ce qu'on perd.
  }
}

export { OPEN };
