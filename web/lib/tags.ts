// Lire et écrire les tags. Le seul endroit qui connaît la forme des deux
// tables de nomenclature.
import "server-only";
import { RUN_TAGS, TAGS, insert, remove, select } from "./supabase";
import { nextColor } from "./tag-colors";
import type { Tag } from "./types";

export async function loadTags(): Promise<Tag[]> {
  return select<Tag>(TAGS, { select: "id,label,color", order: "label.asc" });
}

/** `%` et `_` sont des jokers pour `ilike`, et `\` les échappe : un libellé
 *  qui en porte un — « 100% », par exemple — matcherait autrement n'importe
 *  quoi et se dédupliquerait sur la mauvaise ligne. */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Crée un tag, ou rend celui qui porte déjà ce libellé.
 *
 * La casse ne distingue pas deux tags : l'index unique est posé sur
 * `lower(label)`, et rendre l'existant plutôt qu'une erreur laisse l'appelant
 * écrire « ajoute ce tag » sans avoir à savoir s'il existe. */
export async function createTag(label: string): Promise<Tag> {
  const trimmed = label.trim();
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

/** Les tags de chaque run, par identifiant de run.
 *
 * Une seule lecture pour tous les runs, comme `loadRuns` le fait pour les
 * cases : une requête par run coûterait bien plus cher que les deux petites
 * colonnes ramenées ici. */
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

/** Pose exactement ces tags sur ce run : les liens d'avant sont effacés, les
 *  nouveaux écrits. Remplacer plutôt qu'ajouter/retirer un à un laisse
 *  l'appelant envoyer l'état qu'il veut, sans calculer de différence. */
export async function setRunTags(runId: string, tagIds: number[]): Promise<void> {
  await remove(RUN_TAGS, { run_id: `eq.${runId}` });
  if (tagIds.length === 0) return;
  await insert(
    RUN_TAGS,
    tagIds.map((tagId) => ({ run_id: runId, tag_id: tagId })),
  );
}
