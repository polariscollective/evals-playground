# Taguer les brouillons, et voir les tags dans les listes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un brouillon porte des tags comme un run, ils suivent quand on le lance, ils se voient dans la liste des runs comme dans celle des brouillons, et l'agent MCP peut en poser — en réutilisant ceux qui existent ou en créant les siens.

**Architecture:** Une table de liaison de plus, `eval_run_draft_tags`, jumelle de `eval_run_tags` — un brouillon et un run ont deux espaces d'identifiants distincts, et une table polymorphe perdrait les clés étrangères qui font tout l'intérêt du montage. Côté agent, les tags se nomment par leur **libellé** et non par leur identifiant : un agent pense en mots, et lui imposer un aller-retour pour traduire ses mots en nombres n'apporte rien. Un libellé inconnu crée le tag.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase par PostgREST avec le rôle de service, `node --test` sur `web/lib/**/*.test.mts`.

Ce plan prolonge `docs/superpowers/plans/2026-09-04-des-tags-sur-les-runs.md`, dont les cinq tâches sont faites.

## Global Constraints

- **Les migrations vivent dans `polaris-supabase`**, jamais ici ; la PR se fusionne toute seule.
- **L'outil MCP ajoute des tags, il n'en retire jamais.** `setRunTags` remplace la liste entière : donné tel quel à un agent, il effacerait sans le savoir des tags posés à la main. L'agent fait donc l'union avec l'existant, et retirer reste un geste humain dans l'interface. C'est une contrainte de sûreté, pas une commodité — ne pas l'assouplir sans rouvrir la question.
- **`node --test` ne voit que `web/lib/**/*.test.mts`**, ne résout ni `@/…` ni `@shared/…`, et ne peut pas importer un module qui fait `import "server-only"`. Les imports relatifs des fichiers qu'il atteint portent l'extension `.ts`.
- **Le contrôle d'accès des routes `/api` est `requireUser()`**, dans chaque route.
- **Aucune classe Tailwind construite dynamiquement** : la correspondance couleur → classes est l'objet littéral de `lib/tag-colors.ts`, et rien d'autre.
- **Langue** : anglais pour ce que lit un utilisateur ou une machine ; français pour les commentaires, les noms de tests et les messages de commit.
- Le serveur de développement se lance par `scripts/dev.sh` depuis la racine, jamais `npm run dev` depuis `web/`.
- **Une autre session Claude Code travaille dans ce dépôt.** Chaque tâche ne met en zone d'attente que ses propres fichiers, nommés un par un. Jamais `git add -A`, jamais `git add .`, jamais `git commit -a`, jamais de `stash` ni de `revert` sur le travail d'autrui.
- Un commit par tâche, message en français, attribution en pied :

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
```

---

## Task 1: La table des tags de brouillon

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/<horodatage>_create_eval_run_draft_tags.sql`
- Modify: `.../evals/supabase/schema.sql` (régénéré par la CLI)

- [ ] **Step 1: Créer la migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals
supabase migration new create_eval_run_draft_tags
```

- [ ] **Step 2: Écrire le SQL**

```sql
-- evals-playground : taguer un brouillon.
--
-- Jumelle d'`eval_run_tags`, et non une table polymorphe portant un type et
-- un identifiant : un brouillon et un run vivent dans deux espaces
-- d'identifiants distincts, et une colonne « à quoi ceci se rattache »
-- perdrait les clés étrangères, donc les deux cascades qui sont tout
-- l'intérêt du montage.
--
-- Les tags d'un brouillon sont recopiés sur le run au lancement : le
-- brouillon disparaît alors, et un tag qu'on perdrait à cet instant précis
-- serait perdu au moment exact où il commence à servir.
create table public.eval_run_draft_tags (
  draft_id uuid   not null references public.eval_run_drafts (id) on delete cascade,
  tag_id   bigint not null references public.tags (id)            on delete cascade,
  primary key (draft_id, tag_id)
);

create index eval_run_draft_tags_tag_id_idx on public.eval_run_draft_tags (tag_id);

grant select, insert, delete on public.eval_run_draft_tags to service_role;
```

- [ ] **Step 3: Appliquer, fusionner**

```bash
supabase db push --dry-run   # cette migration seule, sinon s'arrêter et demander
supabase db push
supabase db dump --linked -f supabase/schema.sql
cd .. && git checkout -b draft-tags
git add evals/supabase/migrations evals/supabase/schema.sql
git commit -m "feat(evals): eval_run_draft_tags, pour taguer un brouillon"   # + attribution
git push -u origin draft-tags && gh pr create --fill && gh pr merge --merge --delete-branch
git checkout main && git pull origin main
```

---

## Task 2: Les tags d'un brouillon, côté données

**Files:**
- Modify: `web/lib/supabase.ts` — `DRAFT_TAGS`
- Modify: `web/lib/tags.ts` — les fonctions de brouillon, et `tagsForLabels`

**Interfaces:**
- Produces: `tagsOfDraft(draftId)`, `setDraftTags(draftId, tagIds)`, `tagsByDraft()`, `tagsForLabels(labels)`, `addRunTags(runId, tagIds)`.

- [ ] **Step 1: La constante de table**

Dans `web/lib/supabase.ts`, à côté de `TAGS`/`RUN_TAGS` : `export const DRAFT_TAGS = "eval_run_draft_tags";`

- [ ] **Step 2: Les fonctions**

Dans `web/lib/tags.ts`, en suivant exactement la forme des fonctions de run déjà présentes (`tagsOf`, `setRunTags`, `tagsByRun`) :

- `tagsOfDraft(draftId)` — les tags d'un brouillon ;
- `setDraftTags(draftId, tagIds)` — remplace, comme `setRunTags` ;
- `tagsByDraft()` — tous les brouillons d'un coup, pour la liste ;
- `tagsForLabels(labels: string[]): Promise<Tag[]>` — chaque libellé passé par `createTag`, donc réutilisé s'il existe (sans casse) et créé sinon. C'est par là que l'agent nomme ses tags.
- `addRunTags(runId, tagIds)` — **l'union** avec les tags déjà posés, contrairement à `setRunTags` qui remplace. C'est la seule écriture que l'agent aura sur un run existant, et elle ne doit pas pouvoir effacer le travail de quelqu'un.

- [ ] **Step 3: Vérifier et commiter**

`npx tsc --noEmit && npm test && npx eslint lib/tags.ts lib/supabase.ts`.
Commit : `feat: les tags d'un brouillon, et l'union pour l'agent`.

---

## Task 3: Les tags suivent au lancement

**Files:**
- Modify: `web/app/api/runs/drafts/[draftId]/launch/route.ts` — recopier les tags

**Interfaces:**
- Consumes: `tagsOfDraft`, `setRunTags` (Task 2).

- [ ] **Step 1: Recopier**

Dans la route de lancement, après que le run est créé et démarré et **avant** que le brouillon soit écarté : lire `tagsOfDraft(draftId)` et poser ces tags sur le run neuf.

L'ordre compte. Le brouillon doit encore exister quand on lit ses tags ; et si la copie échoue, mieux vaut un run sans ses tags qu'un lancement en échec — le run tourne déjà à ce stade, l'annuler serait pire. Envelopper la copie de sorte qu'un échec soit journalisé sans faire échouer la réponse, et le dire en commentaire.

> **Attention** : cette route appartenait à une autre session au moment d'écrire ce plan, et son voisinage a changé (`discardDraft`, `markDraftLaunched`). Lire le fichier tel qu'il est avant d'y toucher, et se poser exactement où l'ordre décrit ci-dessus est respecté.

- [ ] **Step 2: Vérifier en direct**

Serveur lancé : taguer un brouillon (par la route de la Task 4, ou à la main en base), le lancer, ouvrir le run créé et vérifier qu'il porte les tags.

Commit : `feat: les tags d'un brouillon suivent le run qu'il produit`.

---

## Task 4: Les routes des tags de brouillon

**Files:**
- Create: `web/app/api/runs/drafts/[draftId]/tags/route.ts` (GET, PUT)
- Modify: `web/lib/api.ts` — `getDraftTags`, `setDraftTags`

**Interfaces:**
- Consumes: `tagsOfDraft`, `setDraftTags` (Task 2).

Mêmes formes que `web/app/api/runs/[runId]/tags/route.ts`, qui existe déjà : `requireUser()` d'abord, `tag_ids` validé comme une liste d'entiers (422 sinon), existence du brouillon vérifiée avant d'écrire (404 sinon, via `DraftNotFound`).

Commit : `feat: les routes des tags d'un brouillon`.

---

## Task 5: Les pastilles dans les deux listes

**Files:**
- Modify: `web/app/runs/page.tsx` — les pastilles sur chaque run et chaque brouillon
- Modify: `web/lib/api.ts` — ce qu'il faut pour charger les tags des deux listes
- Peut nécessiter : une route qui rend les tags de tous les runs / de tous les brouillons d'un coup, plutôt qu'un appel par ligne

**Interfaces:**
- Consumes: `tagsByRun`, `tagsByDraft` (Task 2), `colorClasses` (`lib/tag-colors.ts`).

Les pastilles y sont **en lecture seule** : on tague depuis la page d'un run, pas depuis une liste de quarante lignes. Une pastille par tag, ses classes venant de `colorClasses`, et rien qui construise une classe.

Un appel par ligne serait un appel par ligne : prévoir une lecture groupée, comme `loadRuns` ramène déjà toutes les cases en une fois.

> **Attention** : `web/app/runs/page.tsx` appartenait à une autre session au moment d'écrire ce plan. Lire le fichier tel qu'il est, et se glisser dans sa structure — `DraftList` y est un composant à part, les runs sont rendus dans le corps de la page.

Commit : `feat: les tags dans la liste des runs et celle des brouillons`.

---

## Task 6: Ce que l'agent peut faire des tags

**Files:**
- Modify: `web/app/mcp/route.ts` — `list_tags`, `set_run_tags`, et `tags` sur `submit_draft_run`

**Interfaces:**
- Consumes: `loadTags`, `tagsForLabels`, `addRunTags`, `setDraftTags` (Task 2).

- [ ] **Step 1: `list_tags`**

Un outil sans argument, qui rend les tags existants — leurs libellés, et rien d'autre d'utile à un agent. Sa description doit dire explicitement qu'**un libellé inconnu sera créé** : sans ça, un agent prudent n'osera jamais en proposer un nouveau, et avec ça il évite d'inventer « regression » quand « régression » existe déjà.

- [ ] **Step 2: `tags` sur `submit_draft_run`**

Un `tags: z.array(z.string()).optional()` : des **libellés**, pas des identifiants. Ils passent par `tagsForLabels`, puis `setDraftTags` sur le brouillon qui vient d'être créé. La description dit que les libellés inconnus sont créés.

- [ ] **Step 3: `set_run_tags`**

Pour un run existant : `run_id` et `tags` (des libellés). Passe par `tagsForLabels` puis **`addRunTags`** — l'union, jamais le remplacement. La description doit le dire à l'agent : cet outil ajoute, il ne retire pas, et retirer se fait à la main dans l'interface.

- [ ] **Step 4: Vérifier en direct**

Danse OAuth, puis : `list_tags` rend la liste ; `submit_draft_run` avec deux libellés dont un neuf crée le brouillon avec ses deux tags ; `set_run_tags` sur un run déjà tagué **ajoute** sans effacer l'existant ; le brouillon lancé donne un run qui porte les tags.

Commit : `feat: l'agent peut lire, poser et créer des tags`.

---

## Ce que ce plan ne fait pas

Pas d'édition des tags d'un brouillon dans l'interface : un brouillon s'ouvre désormais dans le formulaire, qui appartient à une autre session, et l'agent comme le lancement couvrent déjà le besoin — les tags deviennent modifiables dès que le run existe. Pas de retrait de tag par l'agent, jamais, et c'est écrit dans les contraintes. Pas de tags sur `/shared`. Pas de renommage ni de suppression de tag : la table se corrige à la main.
