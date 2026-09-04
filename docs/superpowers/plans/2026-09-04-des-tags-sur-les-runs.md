# Des tags sur les runs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Taguer un run depuis sa page — en créant un tag ou en choisissant un qui existe —, chaque tag gardant toujours la même couleur, et les tags remontant dans la fiche courte de `search_runs` avec un filtre par tag.

**Architecture:** Deux tables neuves dans `polaris-supabase` : `tags` (le libellé et sa couleur, une fois pour toutes) et `eval_run_tags`, la liaison, dont les clés étrangères en `on delete cascade` font que supprimer un tag l'enlève partout sans code. La couleur est un **mot-clé** (`teal`, `amber`…), pas un code hexadécimal : Tailwind ne fabrique pas de classe à l'exécution, l'interface fait donc passer ce mot par une correspondance figée. Le choix de la couleur est automatique à la création, pris dans une petite palette — aucun sélecteur à dessiner.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase par PostgREST avec le rôle de service, `node --test` sur `web/lib/**/*.test.mts`.

Le connecteur MCP que ce plan prolonge : `docs/superpowers/specs/2026-09-03-un-connecteur-mcp-design.md`.

## Global Constraints

- **Les migrations vivent dans `polaris-supabase`**, jamais ici. Procédure dans son README ; la PR se fusionne toute seule (décision de l'utilisateur, cette session).
- **`node --test` ne voit que `web/lib/**/*.test.mts`**, ne résout ni `@/…` ni `@shared/…`, et **ne peut pas importer un module qui fait `import "server-only"`**. La logique pure destinée à être testée vit donc dans un fichier séparé de son homologue `server-only`, et **ses imports relatifs portent l'extension `.ts`**.
- **Le contrôle d'accès des routes `/api` est `requireUser()`**, dans chaque route, sans exception.
- **Langue** : ce que lit un utilisateur ou une machine est en anglais ; commentaires, noms de tests et messages de commit en français.
- **Aucune classe Tailwind construite dynamiquement.** `bg-${color}-100` est purgé au build et ne peint rien. La correspondance mot-clé → classes est un objet littéral, écrit en toutes lettres.
- **Vérification à la fin de chaque tâche qui touche `web/`** : `cd web && npx tsc --noEmit && npm test`, plus `npx eslint` sur les fichiers touchés.
- Le serveur de développement se lance par `scripts/dev.sh` depuis la racine, **jamais** `npm run dev` depuis `web/` : le script pose le lien `web/.env.local -> ../.env`, sans lequel l'application n'a aucune variable et rend des 500 muets.
- Un commit par tâche, message en français, attribution en pied :

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
```

---

## Task 1: Les deux tables

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/<horodatage>_create_tags.sql`
- Modify: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/schema.sql` (régénéré par la CLI)

**Interfaces:**
- Produces: `public.tags`, `public.eval_run_tags`.

- [ ] **Step 1: Créer la migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals
supabase migration new create_tags
```

- [ ] **Step 2: Écrire le SQL**

```sql
-- evals-playground : taguer un run.
--
-- La couleur vit sur le tag et non sur le run : deux runs portant le même tag
-- le peindraient sinon différemment. C'est un mot-clé (`teal`, `amber`…) et
-- non un code hexadécimal, parce que Tailwind ne fabrique pas de classe à
-- l'exécution — l'interface fait passer ce mot par une correspondance figée.
--
-- Un entier plutôt qu'un uuid, contrairement aux autres tables de ce projet :
-- une table de nomenclature d'une dizaine de lignes, jamais créée en
-- concurrence et jamais exposée dans une adresse, se lit mieux ainsi.
create table public.tags (
  id         bigint generated always as identity primary key,
  label      text not null,
  color      text not null,
  created_at timestamptz not null default now()
);

-- Sans casse : « Régression » et « régression » sont le même tag, sans quoi
-- la liste se remplit de doublons que personne ne remarque à la saisie.
create unique index tags_label_unique on public.tags (lower(label));

-- La liaison. Les deux cascades sont tout l'intérêt de cette table : supprimer
-- un tag l'enlève de tous les runs, supprimer un run emporte ses liens, et
-- aucun code applicatif n'a à s'en souvenir.
create table public.eval_run_tags (
  run_id uuid   not null references public.eval_runs (id) on delete cascade,
  tag_id bigint not null references public.tags (id)      on delete cascade,
  primary key (run_id, tag_id)
);

create index eval_run_tags_tag_id_idx on public.eval_run_tags (tag_id);

grant select, insert, update, delete on public.tags to service_role;
grant usage, select on sequence public.tags_id_seq to service_role;
grant select, insert, delete on public.eval_run_tags to service_role;
```

- [ ] **Step 3: Appliquer**

```bash
supabase db push --dry-run   # cette migration seule, sinon s'arrêter et demander
supabase db push
supabase db dump --linked -f supabase/schema.sql
```

- [ ] **Step 4: Commiter, ouvrir la PR, la fusionner**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase
git checkout -b tags
git add evals/supabase/migrations evals/supabase/schema.sql
git commit -m "feat(evals): tags et eval_run_tags, pour taguer un run"   # + les deux lignes d'attribution
git push -u origin tags
gh pr create --fill
gh pr merge --merge --delete-branch
git checkout main && git pull origin main
```

Attendu : `main` porte la migration, la branche est supprimée.

---

## Task 2: La palette, et l'accès aux tags

**Files:**
- Create: `web/lib/tag-colors.ts` (pur, testé)
- Create: `web/lib/tag-colors.test.mts`
- Create: `web/lib/tags.ts` (`server-only`)
- Modify: `web/lib/supabase.ts` — `TAGS`, `RUN_TAGS`
- Modify: `web/lib/types.ts` — `Tag`

**Interfaces:**
- Consumes: `tags`, `eval_run_tags` (Task 1).
- Produces: `TAG_COLORS`, `nextColor(usedCount)`, `colorClasses(color)` ; `loadTags()`, `createTag(label)`, `tagsByRun()`, `setRunTags(runId, tagIds)`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `web/lib/tag-colors.test.mts` :

```ts
// La couleur d'un tag ne bouge jamais, et Tailwind ne fabrique pas de classe à
// l'exécution : ces deux règles-là sont tout ce que ce module a à tenir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TAG_COLORS, colorClasses, nextColor } from "./tag-colors.ts";

test("la palette tourne, et ne rend que des couleurs qu'elle connaît", () => {
  for (let i = 0; i < TAG_COLORS.length * 2 + 1; i += 1) {
    assert.ok(TAG_COLORS.includes(nextColor(i)));
  }
});

test("deux tags créés à la suite ne prennent pas la même couleur", () => {
  assert.notEqual(nextColor(0), nextColor(1));
});

test("la palette reprend au début une fois épuisée", () => {
  assert.equal(nextColor(TAG_COLORS.length), nextColor(0));
});

test("chaque couleur porte des classes écrites en toutes lettres", () => {
  // Une classe fabriquée à l'exécution serait purgée au build : ce test tient
  // la table littérale, pas la façon de la lire.
  for (const color of TAG_COLORS) {
    const classes = colorClasses(color);
    assert.match(classes, /bg-/);
    assert.match(classes, /text-/);
    assert.doesNotMatch(classes, /\$\{/);
  }
});

test("une couleur inconnue retombe sur une valeur neutre plutôt que sur rien", () => {
  // Une couleur écrite à la main en base ne doit pas rendre un tag invisible.
  assert.match(colorClasses("cramoisi"), /bg-/);
});
```

- [ ] **Step 2: Voir le test échouer**

```bash
cd web && node --test "lib/tag-colors.test.mts"
```

Attendu : `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Écrire le module pur**

Créer `web/lib/tag-colors.ts` :

```ts
// Les couleurs qu'un tag peut prendre, et leurs classes.
//
// Tailwind ne construit pas de classe à l'exécution : `bg-${color}-100` est
// purgé au build et ne peint rien. La correspondance est donc écrite en
// toutes lettres, et c'est un test qui le rappelle.

export const TAG_COLORS = [
  "teal",
  "amber",
  "sky",
  "rose",
  "violet",
  "lime",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

const CLASSES: Record<TagColor, string> = {
  teal: "bg-teal-100 text-teal-900",
  amber: "bg-amber-100 text-amber-900",
  sky: "bg-sky-100 text-sky-900",
  rose: "bg-rose-100 text-rose-900",
  violet: "bg-violet-100 text-violet-900",
  lime: "bg-lime-100 text-lime-900",
};

const NEUTRAL = "bg-zinc-100 text-zinc-900";

/** La couleur du prochain tag : la palette tourne, sans rien demander à
 *  personne. Un sélecteur de couleur serait une interface de plus pour un
 *  choix qui n'intéresse personne au moment de créer un tag. */
export function nextColor(usedCount: number): TagColor {
  return TAG_COLORS[usedCount % TAG_COLORS.length];
}

/** Les classes d'une couleur. Une valeur inconnue — écrite à la main en base,
 *  ou venue d'une palette plus ancienne — rend du neutre plutôt que rien : un
 *  tag sans classe serait invisible. */
export function colorClasses(color: string): string {
  return CLASSES[color as TagColor] ?? NEUTRAL;
}
```

- [ ] **Step 4: Voir les cinq tests passer**

```bash
cd web && node --test "lib/tag-colors.test.mts"
```

- [ ] **Step 5: Déclarer le type et les tables**

Dans `web/lib/types.ts` :

```ts
/** Un tag, et la couleur qu'il gardera. */
export interface Tag {
  id: number;
  label: string;
  color: string;
}
```

Dans `web/lib/supabase.ts`, à côté de `RUNS`/`SAMPLES`/`DRAFTS` :

```ts
export const TAGS = "tags";
export const RUN_TAGS = "eval_run_tags";
```

- [ ] **Step 6: Écrire l'accès**

Créer `web/lib/tags.ts` :

```ts
// Lire et écrire les tags. Le seul endroit qui connaît la forme des deux
// tables de nomenclature.
import "server-only";
import { RUN_TAGS, TAGS, insert, remove, select } from "./supabase";
import { nextColor } from "./tag-colors";
import type { Tag } from "./types";

export async function loadTags(): Promise<Tag[]> {
  return select<Tag>(TAGS, { select: "id,label,color", order: "label.asc" });
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
    label: `ilike.${trimmed}`,
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
```

- [ ] **Step 7: Vérifier et commiter**

```bash
cd web && npx tsc --noEmit && npm test && npx eslint lib/tag-colors.ts lib/tags.ts
```

Commit : `feat: les tags, leur palette et leur accès`.

---

## Task 3: Les routes

**Files:**
- Create: `web/app/api/tags/route.ts` (GET, POST)
- Create: `web/app/api/runs/[runId]/tags/route.ts` (PUT)

**Interfaces:**
- Consumes: `loadTags`, `createTag`, `setRunTags` (Task 2), `requireUser`.
- Produces: `GET /api/tags`, `POST /api/tags`, `PUT /api/runs/<id>/tags`.

> **Les appels clients de `web/lib/api.ts` ne sont pas ici.** Ils ont été
> déplacés dans la Task 4, qui est la seule à les consommer — une autre session
> travaillait dans ce fichier au moment d'écrire, et rien n'oblige à s'y croiser
> pour du code que personne n'appelle encore.

- [ ] **Step 1: Écrire les routes**

`web/app/api/tags/route.ts` :

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createTag, loadTags } from "@/lib/tags";

export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;
  return NextResponse.json(await loadTags());
}

/** Crée un tag, ou rend celui qui existe déjà sous ce libellé. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 422 });
  }
  return NextResponse.json(await createTag(label), { status: 201 });
}
```

`web/app/api/runs/[runId]/tags/route.ts` :

```ts
import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { NotFound, loadRun } from "@/lib/runs";
import { setRunTags } from "@/lib/tags";

/** Pose la liste des tags d'un run, telle quelle. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const { runId } = await params;
  const body = (await request.json().catch(() => null)) as { tag_ids?: unknown } | null;
  const ids = body?.tag_ids;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) {
    return NextResponse.json({ error: "tag_ids must be a list of integers" }, { status: 422 });
  }

  try {
    // Vérifier l'existence d'abord : sans ça, poser des tags sur un
    // identifiant inconnu écrirait des liens que rien ne rattache.
    await loadRun(runId);
  } catch (error) {
    if (error instanceof NotFound) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    throw error;
  }

  await setRunTags(runId, ids as number[]);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Les appels côté client**

Dans `web/lib/api.ts`, à la fin :

```ts
export const getTags = () => request<Tag[]>("/api/tags");

export const createTag = (label: string) =>
  request<Tag>("/api/tags", { method: "POST", body: JSON.stringify({ label }) });

export const setRunTags = (runId: string, tagIds: number[]) =>
  request<{ ok: true }>(`/api/runs/${runId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tag_ids: tagIds }),
  });
```

(`Tag` s'importe depuis `./types` avec les autres.)

- [ ] **Step 3: Vérifier à la main**

Serveur lancé par `scripts/dev.sh`. Créer un tag, le relire, le poser sur un run existant, vérifier en base, puis reposer une liste vide et vérifier que les liens disparaissent. Un `tag_ids` qui n'est pas une liste d'entiers doit rendre 422 ; un run inconnu, 404.

- [ ] **Step 4: Vérifier et commiter**

```bash
cd web && npx tsc --noEmit && npm test && npx eslint "app/api/tags/route.ts" "app/api/runs/[runId]/tags/route.ts" lib/api.ts
```

Commit : `feat: les routes des tags`.

---

## Task 4: Le champ de tags sur la page d'un run

> **Réécrite le 4 septembre.** La version d'origine visait
> `app/eval/[runId]/page.tsx` telle qu'elle était alors. Une autre session a
> depuis extrait les composants d'affichage dans `components/RunRead.tsx`,
> **partagés avec `/shared`**. Les tags s'éditent donc dans la page privée, qui
> existe toujours à côté — les poser dans `RunRead.tsx` les ferait apparaître,
> et modifiables, sur un run publié.

**Files:**
- Create: `web/components/TagField.tsx`
- Modify: `web/app/eval/[runId]/page.tsx` — l'import et un `<TagField>` sous
  l'en-tête, juste avant le bloc `{publicUrl && …}` (vers la ligne 461)
- Modify: `web/lib/api.ts` — `getTags`, `createTag`, `setRunTags` (reportés
  depuis la Task 3, qui les avait laissés à l'écart pendant qu'une autre
  session travaillait dans ce fichier)

**Interfaces:**
- Consumes: `GET/POST /api/tags` et `PUT /api/runs/<id>/tags` (Task 3),
  `colorClasses` (Task 2).
- Produces: `<TagField runId={...} />`, et les trois appels clients.

Les tags **n'apparaissent pas** sur `/shared` dans cette tâche : la page
publique montre un run, pas la façon dont on le classe, et rien ne presse de
trancher la question. Elle se rouvrira toute seule le jour où quelqu'un la
posera.

- [ ] **Step 1: Écrire le composant**

Créer `web/components/TagField.tsx` — un composant client, autonome : il charge la liste des tags à l'affichage, montre ceux du run en pastilles colorées, et offre un champ où l'on tape. Ce qui est tapé filtre les tags existants ; une entrée choisie s'ajoute, un libellé inconnu propose « Create "…" », qui appelle `createTag` puis l'ajoute. Chaque pastille porte une croix qui la retire. Toute modification appelle `setRunTags` avec la liste complète.

Contraintes de forme, à tenir :
- les classes de couleur viennent de `colorClasses(tag.color)`, **jamais** d'une chaîne construite ;
- l'échec d'un appel se montre (une ligne rouge), il ne disparaît pas en silence ;
- le composant ne suppose pas que le run existe déjà taguable : une liste vide est l'état normal.

- [ ] **Step 2: Le brancher sur la page**

Dans `web/app/eval/[runId]/page.tsx`, importer `TagField` et le rendre sous l'en-tête du run, là où l'adresse publique s'affiche déjà quand le run est publié.

- [ ] **Step 3: Vérifier à l'œil**

Serveur lancé, ouvrir un run : créer un tag, le voir apparaître coloré, recharger la page et le retrouver, en ajouter un second depuis la liste existante, en retirer un, recharger. Ouvrir un autre run et vérifier que le tag créé y est proposé dans la liste, avec la même couleur.

- [ ] **Step 4: Vérifier et commiter**

```bash
cd web && npx tsc --noEmit && npm test && npx eslint components/TagField.tsx "app/eval/[runId]/page.tsx"
```

Commit : `feat: taguer un run depuis sa page`.

---

## Task 5: Les tags dans `search_runs`

**Files:**
- Modify: `web/lib/run-search.ts` — les tags dans la fiche, et le filtre
- Modify: `web/lib/run-search.test.mts` — les cas correspondants
- Modify: `web/app/mcp/route.ts` — le paramètre `tag`, et les tags passés à la recherche

**Interfaces:**
- Consumes: `tagsByRun` (Task 2), `searchRuns` (déjà écrit).
- Produces: `tags: string[]` dans chaque fiche, et un paramètre `tag` sur l'outil.

- [ ] **Step 1: Étendre la fonction pure et ses tests**

`searchRuns` prend un argument de plus — les tags par run — et rend `tags: string[]` (les libellés seuls : un agent ne peint rien) dans chaque fiche. Un `tag` dans les options filtre sur le libellé, sans casse, en plus du reste.

Tests à ajouter : les libellés remontent dans la fiche ; le filtre par tag ne garde que les runs qui le portent ; il se combine avec `query` et avec `status` ; un tag inconnu rend une liste vide, pas une erreur.

- [ ] **Step 2: Brancher l'outil**

Dans `web/app/mcp/route.ts`, l'outil charge `tagsByRun()` en plus de `loadRuns()` et passe les deux à `searchRuns`. Le schéma d'entrée gagne `tag: z.string().optional().describe(...)`, et la description de l'outil dit que les tags sont cherchables.

- [ ] **Step 3: Vérifier en direct**

Serveur lancé par `scripts/dev.sh`, jeton obtenu par la danse OAuth : taguer un run depuis l'interface, puis appeler `search_runs` sans argument (les tags doivent figurer dans les fiches), avec le `tag` posé (le run doit sortir), avec un tag inconnu (liste vide, pas d'erreur).

- [ ] **Step 4: Vérifier et commiter**

```bash
cd web && npx tsc --noEmit && npm test && npx eslint lib/run-search.ts "app/mcp/route.ts"
```

Commit : `feat: les tags dans search_runs, et le filtre par tag`.

---

## Ce que ce plan ne fait pas

Pas de renommage ni de suppression de tag depuis l'interface — la table se corrige à la main le jour où c'est utile, et une interface de gestion pour six tags serait du travail pour personne. Pas de tags sur la liste des runs (`/runs`) : c'est l'endroit où ils seraient le plus utiles à parcourir, et c'est la suite évidente, mais la page d'un run est celle où on les pose. Pas de sélecteur de couleur.
