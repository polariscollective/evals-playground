// Lire et écrire les tags. Le seul endroit qui connaît la forme des deux
// tables de nomenclature.
import "server-only";
import { DRAFT_TAGS, RUN_TAGS, TAGS, insert, remove, select } from "./supabase";
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

/** Les tags d'un seul run.
 *
 * `tagsByRun` ci-dessous ramène tout en une lecture pour la liste des runs ;
 * ici l'appelant n'en veut qu'un, et charger toute la table pour ça serait le
 * mauvais compromis — la page d'un run ne lit qu'un identifiant. */
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

/** Pose exactement ces tags sur ce run : ce qui manque est inséré, ce qui n'y
 *  est plus est retiré — jamais tout effacé puis tout réécrit.
 *
 * Un tag qui reste dans la liste avant et après ne doit jamais, même un
 * instant, perdre son dernier lien : la tâche suivante pose un déclencheur
 * qui supprime un tag devenu orphelin, et PostgREST envoie un `remove` et un
 * `insert` comme deux requêtes HTTP — donc deux transactions distinctes,
 * qu'aucun `deferred` ne peut recoller. Remplacer `[A]` par `[A, B]` en
 * effaçant d'abord tout détacherait A, le déclencheur le supprimerait, et
 * l'insertion qui suit échouerait sur une clé étrangère pointant vers un tag
 * qui n'existe plus. Ne toucher que la différence évite qu'A soit jamais sans
 * lien.
 *
 * L'insertion passe avant la suppression : les deux ensembles sont
 * disjoints par construction (un tag ne peut pas à la fois arriver et
 * partir), donc l'ordre ne change rien à ce que la table contient au final —
 * mais si la seconde requête échoue en cours de route, mieux vaut garder un
 * lien de trop (retiré plus tard) que perdre un lien voulu. */
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

/** Les tags d'un seul brouillon. Jumelle de `tagsOf`. */
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

/** Pose exactement ces tags sur ce brouillon : par différence, comme
 *  `setRunTags` — pour la même raison, jumelle jusque dans le commentaire. */
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

/** Les tags de chaque brouillon, par identifiant de brouillon. Jumelle de
 *  `tagsByRun`, pour la liste des brouillons. */
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

/** Chaque libellé passé par `createTag` : réutilisé s'il existe déjà (sans
 *  casse), créé sinon. C'est par là qu'un agent nomme ses tags en mots plutôt
 *  qu'en identifiants.
 *
 * Dédupliqué sans casse avant l'aller-retour : le même libellé répété deux
 * fois dans la liste ne doit pas chercher/créer deux fois la même ligne. */
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

/** Ajoute ces tags à ceux que porte déjà ce run, sans en retirer aucun.
 *
 * C'est la seule écriture qu'un agent aura sur un run existant. `setRunTags`
 * remplace la liste entière ; la lui confier laisserait un agent effacer en
 * silence des tags qu'un humain a posés. L'union est une contrainte de
 * sécurité, pas une commodité.
 *
 * Insérer un lien déjà présent violerait la clé primaire composite
 * (`run_id`, `tag_id`) : on calcule donc la différence et on ne pose que ce
 * qui manque. */
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
