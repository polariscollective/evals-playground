"use client";

/** Les tags de la liste des runs, gardés en mémoire pour toute la visite.
 *
 * Même raison que `runs-store`, et le même défaut corrigé : le catalogue et les
 * affectations vivaient dans l'état local de la page des runs, donc repartaient
 * de zéro à chaque visite. Les deux réponses sont minuscules — 223 octets et
 * 1 Ko — mais elles coûtent un aller-retour chacune, et les pastilles
 * apparaissaient une demi-seconde après les lignes qu'elles décorent.
 *
 * C'est de la latence, pas du volume : exactement ce qu'un cache règle.
 *
 * Les deux vont ensemble et se rechargent ensemble. Le catalogue seul ne suffit
 * pas — il faut savoir quel tag est posé sur quelle ligne — et les affectations
 * seules non plus : `TagField` a besoin du catalogue pour ses suggestions. Un
 * retrait pouvant vider un tag de son dernier lien et le faire disparaître du
 * catalogue, les relire d'un même geste est ce qui les tient d'accord.
 */

import { useSyncExternalStore } from "react";
import { getTagAssignments, getTags } from "./api";
import { createResource } from "./store";
import type { Tag } from "./types";

export interface TagAssignments {
  runs: Record<string, Tag[]>;
  drafts: Record<string, Tag[]>;
}

export interface TagsState {
  catalog: Tag[];
  assignments: TagAssignments;
}

/** Vide plutôt qu'absent : ce ne sont que des pastilles à côté d'une ligne.
 *  Une lecture ratée doit laisser la page se dessiner sans elles, jamais la
 *  casser — le comportement que la page tenait déjà avant ce magasin. */
const EMPTY: TagsState = { catalog: [], assignments: { runs: {}, drafts: {} } };

const tags = createResource<TagsState>(async () => {
  const [catalog, assignments] = await Promise.all([getTags(), getTagAssignments()]);
  return { catalog, assignments };
});

export const refreshTags = tags.refresh;
export const ensureTagsLoaded = tags.ensureLoaded;

export function useTags(): TagsState {
  const state = useSyncExternalStore(tags.subscribe, tags.get, tags.getInitial);
  return state.data ?? EMPTY;
}
