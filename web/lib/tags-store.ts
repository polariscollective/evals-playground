"use client";

/** The tags of the runs list, kept in memory for the whole visit.
 *
 * The same reason as `runs-store`, and the same fault fixed: the catalogue and
 * the assignments lived in the runs page's local state, and so started from
 * scratch at every visit. Both responses are tiny — 223 bytes and 1 KB — but
 * they cost a round trip each, and the pills appeared half a second after the
 * rows they decorate.
 *
 * That is latency, not volume: exactly what a cache settles.
 *
 * Les deux vont ensemble et se rechargent ensemble. Le catalogue seul ne suffit
 * not — it must be known which tag is on which row — and the assignments
 * seules non plus : `TagField` a besoin du catalogue pour ses suggestions. Un
 * a removal being able to empty a tag of its last link and make it disappear
 * from the catalogue, reading them back in one gesture is what keeps them in
 * agreement.
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

/** Empty rather than absent: these are only pills beside a row. A failed read
 *  must let the page draw itself without them, never break it — the behaviour
 *  the page already held before this store. */
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
