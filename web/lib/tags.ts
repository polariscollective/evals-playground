// Reading and writing the tags. The only place that knows the shape of the two
// nomenclature tables.
import "server-only";
import { DRAFT_TAGS, RUN_TAGS, TAGS, insert, remove, select } from "./supabase";
import { nextColor } from "./tag-colors";
import { isReservedTag } from "./run-filters";
import type { Tag } from "./types";

export async function loadTags(): Promise<Tag[]> {
  return select<Tag>(TAGS, { select: "id,label,color", order: "label.asc" });
}

/** `%` and `_` are wildcards for `ilike`, and `\` escapes them: a label that
 *  carries one — "100%", for instance — would otherwise match anything and
 *  deduplicate onto the wrong row. */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Creates a tag, or returns the one that already carries this label.
 *
 * Case does not distinguish two tags: the unique index sits on `lower(label)`,
 * and returning the existing one rather than an error lets the caller write
 * "add this tag" without having to know whether it exists. */
export async function createTag(label: string): Promise<Tag> {
  const trimmed = label.trim();
  // The guard is here and not in the route: `tagsForLabels` also creates tags,
  // for the MCP tool that lays them on a run. Two doors, one rule — putting it
  // upstream of only one would leave the other open.
  //
  // A real tag named "local" would be confused in the filter bar with the
  // pseudo-tag of the same name, and one would hide the other without anything
  // saying so. See `run-filters.ts`.
  if (isReservedTag(trimmed)) {
    throw new Error(
      `"${trimmed}" is reserved — the runs list already uses it to filter on ` +
        `how a run was launched or where it ran.`,
    );
  }
  const existing = await select<Tag>(TAGS, {
    select: "id,label,color",
    label: `ilike.${escapeIlike(trimmed)}`,
    limit: 1,
  });
  if (existing[0]) return existing[0];

  const all = await loadTags();
  const rows = await insert<Tag>(
    TAGS,
    { label: trimmed, color: nextColor(all.length) },
    { returning: true },
  );
  return rows[0];
}

/** The tags of a single run.
 *
 * `tagsByRun` below brings back everything in one read for the runs list; here
 * the caller wants only one, and loading the whole table for that would be the
 * wrong trade-off — a run's page reads a single identifier. */
export async function tagsOf(runId: string): Promise<Tag[]> {
  const links = await select<{ tag_id: number }>(RUN_TAGS, {
    select: "tag_id",
    run_id: `eq.${runId}`,
  });
  if (links.length === 0) return [];
  const ids = [...new Set(links.map((link) => link.tag_id))];
  return select<Tag>(TAGS, {
    select: "id,label,color",
    id: `in.(${ids.join(",")})`,
    order: "label.asc",
  });
}

/** The tags of each run, by run identifier.
 *
 * A single read for every run, as `loadRuns` does for the cells: one request
 * per run would cost far more than the two small columns brought back here. */
export async function tagsByRun(): Promise<Map<string, Tag[]>> {
  const [tags, links] = await Promise.all([
    loadTags(),
    select<{ run_id: string; tag_id: number }>(RUN_TAGS, {
      select: "run_id,tag_id",
    }),
  ]);
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const byRun = new Map<string, Tag[]>();
  for (const link of links) {
    const tag = byId.get(link.tag_id);
    if (!tag) continue;
    const list = byRun.get(link.run_id);
    if (list) list.push(tag);
    else byRun.set(link.run_id, [tag]);
  }
  return byRun;
}

/** Lays exactly these tags on this run: what is missing is inserted, what is
 *  no longer there is withdrawn — never everything erased then everything
 *  rewritten.
 *
 * A tag that stays in the list before and after must never, even for an
 * instant, lose its last link: the following task lays down a trigger that
 * deletes a tag once orphaned, and PostgREST sends a `remove` and an `insert`
 * as two HTTP requests — so two distinct transactions, which no `deferred` can
 * glue back together. Replacing `[A]` by `[A, B]` by erasing everything first
 * would detach A, the trigger would delete it, and the insertion that follows
 * would fail on a foreign key pointing at a tag that no longer exists. Touching
 * only the difference keeps A from ever being without a link.
 *
 * The insertion comes before the deletion: the two sets are disjoint by
 * construction (a tag cannot both arrive and leave), so the order changes
 * nothing about what the table ends up holding — but if the second request
 * fails midway, better to keep one link too many (withdrawn later) than to lose
 * a link that was wanted. */
export async function setRunTags(runId: string, tagIds: number[]): Promise<void> {
  const existing = await select<{ tag_id: number }>(RUN_TAGS, {
    select: "tag_id",
    run_id: `eq.${runId}`,
  });
  const before = new Set(existing.map((link) => link.tag_id));
  const after = new Set(tagIds);

  const toAdd = [...after].filter((tagId) => !before.has(tagId));
  const toRemove = [...before].filter((tagId) => !after.has(tagId));

  if (toAdd.length > 0) {
    await insert(
      RUN_TAGS,
      toAdd.map((tagId) => ({ run_id: runId, tag_id: tagId })),
    );
  }
  if (toRemove.length > 0) {
    await remove(RUN_TAGS, { run_id: `eq.${runId}`, tag_id: `in.(${toRemove.join(",")})` });
  }
}

/** The tags of a single draft. Twin of `tagsOf`. */
export async function tagsOfDraft(draftId: string): Promise<Tag[]> {
  const links = await select<{ tag_id: number }>(DRAFT_TAGS, {
    select: "tag_id",
    draft_id: `eq.${draftId}`,
  });
  if (links.length === 0) return [];
  const ids = [...new Set(links.map((link) => link.tag_id))];
  return select<Tag>(TAGS, {
    select: "id,label,color",
    id: `in.(${ids.join(",")})`,
    order: "label.asc",
  });
}

/** Lays exactly these tags on this draft: by difference, like `setRunTags` —
 *  for the same reason, twin down to the comment. */
export async function setDraftTags(draftId: string, tagIds: number[]): Promise<void> {
  const existing = await select<{ tag_id: number }>(DRAFT_TAGS, {
    select: "tag_id",
    draft_id: `eq.${draftId}`,
  });
  const before = new Set(existing.map((link) => link.tag_id));
  const after = new Set(tagIds);

  const toAdd = [...after].filter((tagId) => !before.has(tagId));
  const toRemove = [...before].filter((tagId) => !after.has(tagId));

  if (toAdd.length > 0) {
    await insert(
      DRAFT_TAGS,
      toAdd.map((tagId) => ({ draft_id: draftId, tag_id: tagId })),
    );
  }
  if (toRemove.length > 0) {
    await remove(DRAFT_TAGS, { draft_id: `eq.${draftId}`, tag_id: `in.(${toRemove.join(",")})` });
  }
}

/** The tags of each draft, by draft identifier. Twin of `tagsByRun`, for the
 *  drafts list. */
export async function tagsByDraft(): Promise<Map<string, Tag[]>> {
  const [tags, links] = await Promise.all([
    loadTags(),
    select<{ draft_id: string; tag_id: number }>(DRAFT_TAGS, {
      select: "draft_id,tag_id",
    }),
  ]);
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const byDraft = new Map<string, Tag[]>();
  for (const link of links) {
    const tag = byId.get(link.tag_id);
    if (!tag) continue;
    const list = byDraft.get(link.draft_id);
    if (list) list.push(tag);
    else byDraft.set(link.draft_id, [tag]);
  }
  return byDraft;
}

/** Every label passed through `createTag`: reused if it already exists
 *  (case-insensitively), created otherwise. This is how an agent names its tags
 *  in words rather than in identifiers.
 *
 * Deduplicated case-insensitively before the round trip: the same label
 * repeated twice in the list must not look up or create the same row twice. */
export async function tagsForLabels(labels: string[]): Promise<Tag[]> {
  const seen = new Set<string>();
  const tags: Tag[] = [];
  for (const label of labels) {
    const key = label.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(await createTag(label));
  }
  return tags;
}

/** Adds these tags to the ones this run already carries, withdrawing none.
 *
 * This is the only write an agent will have on an existing run. `setRunTags`
 * replaces the whole list; entrusting it to an agent would let it silently
 * erase tags a human laid down. The union is a safety constraint, not a
 * convenience.
 *
 * Inserting a link already present would violate the composite primary key
 * (`run_id`, `tag_id`): so we compute the difference and lay down only what is
 * missing. */
export async function addRunTags(runId: string, tagIds: number[]): Promise<void> {
  const existing = await select<{ tag_id: number }>(RUN_TAGS, {
    select: "tag_id",
    run_id: `eq.${runId}`,
  });
  const already = new Set(existing.map((link) => link.tag_id));
  const missing = [...new Set(tagIds)].filter((tagId) => !already.has(tagId));
  if (missing.length === 0) return;
  await insert(
    RUN_TAGS,
    missing.map((tagId) => ({ run_id: runId, tag_id: tagId })),
  );
}
