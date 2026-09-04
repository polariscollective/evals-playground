# Un tag délié de partout disparaît, et les listes deviennent éditables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retirer un tag de partout le supprime pour de bon — c'est le seul geste de suppression, il n'y en aura pas d'autre à apprendre. Et les tags s'ajoutent comme se retirent depuis la liste des runs et celle des brouillons, plus seulement depuis la page d'un run.

**Architecture:** Le ramassage vit dans la base, en déclencheur, et non dans le code : supprimer un run efface ses liens **en cascade**, sans qu'aucune ligne de TypeScript ne tourne — un nettoyage applicatif ne verrait jamais ce cas. Mais un déclencheur oblige à corriger d'abord `setRunTags`/`setDraftTags`, qui travaillent aujourd'hui en « j'efface tout, je réécris » : le premier effacement orphelinerait un tag qu'on s'apprête à reposer, le déclencheur le supprimerait, et la réécriture échouerait sur une clé étrangère morte. Ces deux fonctions passent donc en différentiel.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase par PostgREST avec le rôle de service, `node --test` sur `web/lib/**/*.test.mts`.

Ce plan prolonge `2026-09-04-des-tags-sur-les-runs.md` et `2026-09-04-taguer-les-brouillons-et-les-listes.md`, tous deux terminés.

## Global Constraints

- **L'ordre des deux premières tâches n'est pas négociable.** Le différentiel (Task 1) est fusionné et déployé **avant** le déclencheur (Task 2). Dans l'autre sens, retirer un tag d'un run casse le champ de tags en production entre les deux.
- **Les migrations vivent dans `polaris-supabase`** ; la PR se fusionne toute seule.
- **L'outil MCP ajoute des tags, il n'en retire jamais.** Inchangé, et à ne pas assouplir : `addRunTags` reste la seule écriture de l'agent sur un run existant.
- **`node --test` ne voit que `web/lib/**/*.test.mts`**, ne résout ni `@/…` ni `@shared/…`, et ne peut pas importer un module qui fait `import "server-only"`. Les imports relatifs des fichiers qu'il atteint portent l'extension `.ts`.
- **Le contrôle d'accès des routes `/api` est `requireUser()`**, dans chaque route.
- **Aucune classe Tailwind construite dynamiquement** : la correspondance couleur → classes est l'objet littéral de `lib/tag-colors.ts`.
- **Langue** : anglais pour ce que lit un utilisateur ou une machine ; français pour les commentaires, les tests et les commits.
- Le serveur de développement se lance par `scripts/dev.sh` depuis la racine, jamais `npm run dev` depuis `web/`.
- **Une autre session Claude Code travaille dans ce dépôt.** Chaque tâche ne met en zone d'attente que ses propres fichiers, nommés un par un. Jamais `git add -A`, jamais `git add .`, jamais `git commit -a`, jamais de `stash` ni de `revert` sur autrui.
- Attribution en pied de chaque commit :

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01DqHrj98bad2W2rx8MvL7mu
```

---

## Task 1: Poser les tags par différence, et non en effaçant tout

**Cette tâche doit être déployée avant la Task 2.** Elle est sans effet visible seule — même comportement, moins d'écritures — et c'est exactement ce qui la rend sûre à envoyer d'abord.

**Files:**
- Modify: `web/lib/tags.ts` — `setRunTags`, `setDraftTags`

- [ ] **Step 1: Réécrire les deux fonctions**

Aujourd'hui : `remove(...)` sur tous les liens de la cible, puis `insert(...)` de la nouvelle liste. Demain : lire les liens existants, supprimer **seulement ceux qui partent**, insérer **seulement ceux qui arrivent**.

`addRunTags` fait déjà exactement ce calcul pour sa moitié — s'en inspirer pour rester cohérent de voix et de forme.

Le commentaire doit dire *pourquoi*, parce que la raison n'est pas devinable en lisant le code : un effacement complet orphelinerait un instant un tag qu'on repose juste après, et le déclencheur de la tâche suivante le supprimerait entre les deux requêtes.

Cas à tenir : liste vide en entrée (tout part), liste identique à l'existante (aucune écriture), doublons dans l'entrée.

- [ ] **Step 2: Vérifier**

`npx tsc --noEmit && npm test && npx eslint lib/tags.ts`.

En direct, serveur lancé : sur un run, poser deux tags, en retirer un, en remettre un autre, vérifier l'état après chaque étape par `GET /api/runs/<id>/tags`. Faire de même sur un brouillon. Vérifier qu'une liste identique n'écrit rien (les identifiants des tags ne changent pas, et rien ne casse).

Commit : `refactor: poser les tags par différence plutôt qu'en effaçant tout`.

---

## Task 2: Le déclencheur qui ramasse les tags orphelins

**À faire seulement une fois la Task 1 fusionnée et déployée.**

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/<horodatage>_delete_orphan_tags.sql`
- Modify: `.../evals/supabase/schema.sql` (régénéré par la CLI)

- [ ] **Step 1: Écrire la migration**

```sql
-- evals-playground : un tag qui n'est plus posé nulle part disparaît.
--
-- Dans la base et non dans le code, parce que supprimer un run efface ses
-- liens en cascade, sans qu'aucune ligne applicative ne tourne : un ramassage
-- écrit côté TypeScript ne verrait jamais ce cas-là.
--
-- Il n'y a donc pas d'autre geste de suppression à apprendre — délier un tag
-- de partout, c'est le supprimer. En échange, un tag recréé plus tard repart
-- avec la couleur suivante de la palette, et non la sienne : c'est le prix
-- accepté pour n'avoir qu'un seul geste.
--
-- Suppose que setRunTags/setDraftTags posent les liens par différence. Une
-- écriture qui effacerait d'abord tous les liens d'une cible orphelinerait un
-- tag qu'elle s'apprête à reposer, et ce déclencheur le supprimerait entre
-- les deux requêtes.
create or replace function public.delete_orphan_tag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from eval_run_tags where tag_id = old.tag_id)
     and not exists (select 1 from eval_run_draft_tags where tag_id = old.tag_id)
  then
    delete from tags where id = old.tag_id;
  end if;
  return null;
end;
$$;

create trigger eval_run_tags_delete_orphan
  after delete on public.eval_run_tags
  for each row execute function public.delete_orphan_tag();

create trigger eval_run_draft_tags_delete_orphan
  after delete on public.eval_run_draft_tags
  for each row execute function public.delete_orphan_tag();
```

- [ ] **Step 2: Appliquer, fusionner**

`supabase db push --dry-run`, puis `db push`, puis `db dump --linked -f supabase/schema.sql`. Branche, PR, `gh pr merge --merge --delete-branch`, retour sur `main`.

- [ ] **Step 3: Vérifier en direct, les quatre chemins**

Un tag ne doit disparaître qu'au bon moment. Vérifier :
1. tag posé sur un seul run, retiré de ce run → le tag n'existe plus (`GET /api/tags`) ;
2. tag posé sur deux runs, retiré d'un seul → le tag existe toujours ;
3. tag posé sur un run **et** un brouillon, retiré du run → il existe toujours (le lien de brouillon le retient) ;
4. tag posé sur un seul run, **le run supprimé** → le tag n'existe plus, par la cascade — c'est le cas que seul un déclencheur peut attraper.

---

## Task 3: Ajouter et retirer des tags depuis les listes

**Files:**
- Modify: `web/components/TagField.tsx` — recevoir le catalogue et l'état courant, plutôt que de les charger
- Modify: `web/app/eval/[runId]/page.tsx` — s'adapter à la nouvelle interface
- Modify: `web/app/runs/page.tsx` — remplacer les pastilles en lecture seule par le champ éditable, sur les runs comme sur les brouillons

**Interfaces:**
- Consumes: `getTags`, `createTag`, `setRunTags`, `getTagAssignments` (déjà là), plus le poseur de tags de brouillon.

- [ ] **Step 1: Rendre `TagField` utilisable en liste**

Aujourd'hui il charge lui-même le catalogue et les tags de son run. Une liste de quarante lignes ferait donc quatre-vingts requêtes. Il doit recevoir en paramètres : les tags courants, le catalogue, et de quoi enregistrer — la page possède déjà tout cela en une lecture (`getTagAssignments`).

Garder son autonomie actuelle sur la page d'un run, ou l'y adapter aussi : au choix de l'implémenteur, tant qu'une liste ne fait pas une requête par ligne. Le plus simple est probablement de le rendre entièrement contrôlé et de laisser chaque page décider quoi lui passer.

Il doit servir aussi bien un run qu'un brouillon — ce qui change entre les deux n'est que la fonction d'enregistrement.

- [ ] **Step 2: Le brancher dans la liste**

Sur chaque ligne de run et chaque ligne de brouillon. Contraintes :
- une modification met à jour l'état de la page, pour que le catalogue reste juste après qu'un tag est créé **ou disparaît** — avec le déclencheur de la Task 2, retirer un tag de sa dernière ligne le fait sortir du catalogue, et le champ ne doit pas continuer de le proposer ;
- un échec se voit et ne laisse pas l'écran raconter autre chose que la base ;
- les classes de couleur viennent de `colorClasses`, jamais construites ;
- rester discret : c'est une liste, pas quarante formulaires.

- [ ] **Step 3: Vérifier**

`npx tsc --noEmit && npm test && npx eslint` sur les fichiers touchés.

En direct, et **au navigateur cette fois** si le profil Chrome est libre (`mcp__chrome-devtools__*`) : depuis `/runs`, ajouter un tag à un run, en retirer un, en créer un nouveau ; faire de même sur un brouillon ; vérifier qu'un tag retiré de sa dernière ligne disparaît aussi du champ des autres lignes ; vérifier que la page d'un run continue de fonctionner. Si le profil est verrouillé, le dire franchement et se rabattre sur les routes.

Commit : `feat: ajouter et retirer des tags depuis les listes`.

---

## Ce que ce plan ne fait pas

Pas d'écran de gestion des tags : délier partout suffit à supprimer, et c'était tout l'objet du choix. Pas de renommage. Pas de ramassage des tags **jamais** posés — le déclencheur ne se réveille qu'à la suppression d'un lien, donc un tag créé puis abandonné avant d'être posé survit ; c'est une fenêtre étroite (l'interface pose le tag dans la foulée de sa création) et la traiter demanderait un balayage périodique pour un cas qui ne s'est encore jamais produit.
