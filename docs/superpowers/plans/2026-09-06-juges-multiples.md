# Plusieurs juges par run — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire d'un juge un objet à part entière — un run porte autant de juges qu'on veut, chacun note chaque conversation, l'un d'eux est le principal.

**Architecture:** Trois tables. `judges` porte la configuration d'un juge. `run_judges` porte son rôle dans un run — principal, type système, supprimé. `judge_scores` porte ce qu'il a trouvé sur chaque conversation, une ligne par couple, **créée d'avance** au lancement comme l'est déjà la matrice.

**Tech Stack:** Python 3.12 / `inspect_ai` / pydantic côté moteur ; Next.js 16 / React 19 / TypeScript côté web ; Supabase (PostgREST) pour le stockage.

**Spec:** `docs/superpowers/specs/2026-09-06-juges-multiples.md` — **à lire avant toute tâche.** Elle porte les raisons ; ce plan ne porte que la marche à suivre.

## Une note sur la forme de ce plan

Le plan précédent de ce dépôt donnait le code exact à écrire. Sept vrais défauts y ont été trouvés par les implémenteurs et les revues, tous de deux sortes : des fichiers que le plan n'avait pas mis dans le périmètre, et des extraits que j'avais écrits de mémoire sans relire le code réel.

Ce plan change de forme en conséquence : il donne le **périmètre exact**, les **contrats** et les **invariants**, et demande aux implémenteurs de lire le code avant d'écrire. Là où il montre du code, c'est une intention, pas une dictée — un extrait qui contredirait le fichier réel doit être signalé, pas recopié.

## Global Constraints

- **Les migrations vivent dans `polaris-supabase`**, sous `evals/supabase/migrations/`. Sur ce dépôt-là, écrire sur `main` et pousser est autorisé.
- **Sur ce dépôt-ci : ne rien pousser, ne pas merger.** Le travail reste sur la branche `juges-multiples`.
- Les données lues à l'identique par Python et TypeScript vivent dans `shared/*.json`, lues par `playground.shared_data.load` d'un côté et par un import dans `web/lib/shared.ts` de l'autre. Jamais de valeur recopiée.
- Commentaires et docstrings en **français** ; identifiants en anglais ; texte envoyé à un modèle, texte à l'écran et descriptions d'outils MCP en **anglais**.
- Tests Python : `pytest` depuis la racine. Tests TypeScript : `cd web && npm test`.
- `web/AGENTS.md` lie tout code sous `web/` qui dépend de Next.js : lire le guide dans `web/node_modules/next/dist/docs/` avant d'écrire.
- Le lint remonte 251 erreurs préexistantes, toutes dans `web/public/inspect-view/assets`. N'en ajouter aucune ailleurs.
- **Tout test de régression ajouté doit être vu échouer** : casser ce qu'il protège, constater, restaurer, et le rapporter. C'est la norme de ce dépôt.

## Le périmètre exact

Relevé par recherche, à la racine du chantier. **Treize fichiers lisent un score aujourd'hui**, et chacun devra le lire autrement :

| fichier | ce qu'il en fait |
|---|---|
| `backend/playground/eval_schemas.py` | les modèles de configuration et de résultat |
| `backend/playground/scoring.py` | les deux juges, leur appel, leur lecture de note |
| `backend/playground/batch_job.py` | le câblage du job, les trois modes |
| `backend/playground/supabase_store.py` | l'écriture des cases et des notes |
| `web/lib/types.ts` | les types partagés |
| `web/lib/runs.ts` | la lecture d'un run et de ses cases |
| `web/lib/matrix.ts` | l'agrégation en cases de matrice |
| `web/lib/awareness.ts` | le compte d'éveil et ses seuils |
| `web/lib/deepen-counts.ts` | l'approfondissement — **facile à oublier** |
| `web/lib/exports.ts` | le CSV et le résumé markdown |
| `web/app/eval/[runId]/page.tsx` | la page d'un run — **oubliée du plan précédent** |
| `web/components/RunRead.tsx` | la matrice, les tentatives, le voyant |
| `web/app/mcp/route.ts` | les outils MCP |

`backend/playground/job.py`, `judging.py` et `schemas.py` sortent aussi à la recherche : c'est le pipeline de génération de scénarios, **débranché depuis août** et sans appelant. Ne pas y toucher.

---

## Prérequis : les migrations, dans `polaris-supabase`

Trois tables, puis la reprise des données, puis le retrait des anciennes colonnes. Détail en Task 1.

---

## Task 1: Les trois tables, et la reprise des données

**Dépôt :** `polaris-supabase` — **pas celui-ci**.

**Interfaces produites :** les tables `judges`, `run_judges`, `judge_scores`, et les runs existants repris dedans.

- [ ] **Step 1: Lire les conventions du dépôt**

Lire son `CLAUDE.md`, puis les migrations récentes sous `evals/supabase/migrations/` — en particulier `20260905213414_awareness_judge.sql`, la dernière de ce chantier. Reprendre exactement leur forme : nommage des fichiers, style, langue des commentaires.

Lire aussi la forme réelle de `eval_runs` et `eval_samples` avant d'écrire : si le schéma diffère de ce que ce plan suppose, **s'arrêter et le signaler**.

- [ ] **Step 2: Créer les trois tables**

`judges` — la configuration d'un juge :

- son identifiant ;
- `criterion` et `rubric` : la question et l'échelle, telles que l'utilisateur les écrit. **Nulles pour un juge système**, dont le texte vit dans le code ;
- `model` : le modèle qui juge ;
- `system_type` : nul pour un juge ordinaire, sinon le type — `'awake'` est le seul aujourd'hui ;
- qui l'a créé, quand.

`run_judges` — la liaison :

- son identifiant, le run, le juge ;
- `is_principal` ;
- `deleted_at`, nul tant qu'elle est vivante ;
- quand elle a été créée.

`judge_scores` — ce qu'un juge a trouvé sur une conversation :

- `run_judge_id`, `sample_id` ;
- `status` : en attente, noté, sans note, en panne — **la même distinction à trois que le produit tient partout**, plus l'attente ;
- `score`, `justification`, `error`.

**Les contraintes, qui sont le cœur de cette tâche :**

1. Au plus une liaison **vivante** principale par run.
2. Au plus une liaison **vivante** d'un `system_type` donné par run.
3. Un score par couple (`run_judge_id`, `sample_id`), jamais deux.
4. **La liaison et la conversation d'un score doivent désigner le même run.** Un score connaît son run par deux chemins ; rien ne garantit tout seul qu'ils s'accordent.

Les trois premières se posent par index uniques partiels. La quatrième demande un peu plus — clé étrangère composée, ou déclencheur. Choisir, et **écrire en commentaire pourquoi ce choix**.

Écrire un `COMMENT ON COLUMN` sur tout ce qui n'est pas évident, comme le fait le reste de ce dépôt : c'est ce qui expliquera ces tables à quelqu'un dans six mois.

- [ ] **Step 3: Reprendre les runs existants**

Pour chaque run existant :

- un juge construit depuis `config->>'criterion'`, `config->'rubric'`, `config->'models'->>'judge'` ;
- une liaison principale vers lui ;
- une ligne de `judge_scores` par conversation, reprise de `eval_samples.score` et `.justification`, avec le statut qui convient — noté si le score est présent, sans note sinon, en panne si `eval_samples.error` l'indique.

Si le run avait le juge d'éveil (`config->>'check_eval_awareness'` non `false`) et qu'au moins une conversation porte une note d'éveil : un juge de type `awake`, sa liaison, et ses scores repris des colonnes `awareness_*`.

**Vérifier la reprise avant de continuer** : compter les runs, les conversations, et les scores obtenus, et dire si les nombres s'accordent.

- [ ] **Step 4: Retirer les anciennes colonnes**

Une fois la reprise vérifiée : retirer de `eval_samples` les colonnes `score`, `justification`, `awareness_score`, `awareness_justification`, `awareness_error`.

**Uniquement si l'étape 3 a été vérifiée.** Sinon, s'arrêter et le dire.

- [ ] **Step 5: PR, merge, application**

Créer une branche, commiter, ouvrir une PR avec `gh`, la merger, appliquer à la base. Si l'application échoue ou demande une authentification indisponible, ne rien forcer : le dire.

- [ ] **Step 6: Rapport**

Les fichiers créés, l'URL de la PR, son état, si la base est à jour, et **les nombres de la reprise**.

---

## Task 2: Les modèles, des deux côtés

**Files:**
- Modify: `backend/playground/eval_schemas.py`
- Modify: `web/lib/types.ts`

**Interfaces produites :** un modèle de juge, de liaison et de score, en Python et en TypeScript, lus par tout le reste du plan.

Ce que chaque modèle porte est décrit en Task 1. **Lire la migration réellement écrite** plutôt que ce plan : c'est elle qui fait foi une fois posée.

Points à ne pas rater :

- `criterion` et `rubric` sont **nuls pour un juge système**. Le type doit le permettre.
- Le statut d'un score porte **quatre** états, dont l'attente. Ne pas le réduire à trois.
- La configuration d'un run gagne une liste de juges. **L'ancienne forme — une question et une échelle au premier niveau — reste valide et décrit le principal.** Les deux doivent coexister dans le type.

- [ ] **Step 1: Écrire les modèles, avec leurs docstrings**
- [ ] **Step 2: Vérifier** — `pytest` et `cd web && npx tsc --noEmit` passent
- [ ] **Step 3: Commiter**

---

## Task 3: Lire et écrire les juges

**Files:**
- Modify: `backend/playground/supabase_store.py`
- Modify: `web/lib/runs.ts`

**Interfaces produites :**
- côté Python : charger les juges vivants d'un run, écrire un score ;
- côté TypeScript : charger les juges vivants d'un run, créer juges + liaisons + lignes de score au lancement, délier un juge, désigner le principal.

**L'invariant qui gouverne cette tâche :** le filtre « liaison non supprimée » vit à **un seul endroit**, dans la fonction qui charge les juges d'un run. Rien d'autre n'a le droit de lire cette table autrement.

C'est le piège classique de la suppression douce, et ce chantier vient d'en donner deux exemples. Le rendre structurellement impossible vaut mieux que de s'en souvenir : une seule fonction lit, tout le reste passe par elle.

- [ ] **Step 1: Écrire les lectures, avec ce filtre unique**
- [ ] **Step 2: Écrire les créations au lancement**

Les lignes de score sont créées **toutes, en attente**, au moment où le run est créé — comme le sont déjà les cases de la matrice. Lire `cellsForRun` dans `web/lib/cells.ts` et suivre son geste.

- [ ] **Step 3: Tester ce qui est testable** — la construction des lignes est une fonction pure, elle se teste vraiment
- [ ] **Step 4: Vérifier et commiter**

---

## Task 4: Le moteur, N juges au lieu de deux

**Files:**
- Modify: `backend/playground/scoring.py`
- Modify: `backend/playground/batch_job.py`

**Ce que ça remplace :** aujourd'hui `rubric_judge` appelle le juge de l'utilisateur puis, éventuellement, le juge d'éveil ; `awareness_only_judge` fait la passe de rattrapage. Les deux deviennent un seul mécanisme : **pour chaque juge vivant qui a une ligne de score en attente sur cette conversation, l'appeler et remplir la ligne.**

**Les trois invariants à préserver, et ils ont coûté cher :**

1. **La panne d'un juge ne coûte jamais sa note à un autre.** Chaque juge écrit sa propre ligne ; l'échec de l'un ne touche pas les lignes des autres.
2. **Une annulation ne fait pas perdre une note déjà obtenue et déjà payée.** `rubric_judge` porte aujourd'hui un `except BaseException` autour de l'appel d'éveil, avec un commentaire qui explique pourquoi `BaseException` et pas `Exception` — `asyncio.CancelledError` n'hérite plus d'`Exception` depuis Python 3.8. Lire ce commentaire et généraliser la garde.
3. **Un juge système reçoit son texte depuis le code, par son type** — jamais depuis la base.

Le mode `rejudge` disparaît au profit de « ajouter un juge, puis remplir ce qui est en attente ». Le mode `awareness` disparaît de même. **Il ne reste qu'un mode de rattrapage**, valable pour n'importe quel juge.

- [ ] **Step 1: Lire les deux fichiers en entier avant d'écrire.** Ils portent beaucoup de raisonnement en commentaire, et ce plan ne le répète pas.
- [ ] **Step 2: Écrire le mécanisme unique**
- [ ] **Step 3: Tester les trois invariants, chacun vu échouer**
- [ ] **Step 4: Vérifier et commiter**

---

## Task 5: La configuration d'un run

**Files:**
- Modify: `web/lib/config-file.ts`
- Modify: `web/lib/validate.ts`

**Le contrat :** un fichier porte la question et l'échelle de tous les juges non supprimés, avec la marque du principal. **Un fichier écrit à l'ancienne — une question et une échelle au premier niveau — reste valide et décrit le juge principal.**

Sans cette compatibilité, tous les fichiers écrits jusqu'ici sont refusés et tous les agents doivent réapprendre le format.

Attention au piège déjà rencontré sur ce fichier : une clé écrite à l'intérieur d'un bloc conditionnel se perd silencieusement à l'aller-retour. **Tester l'aller-retour**, avec et sans juges supplémentaires.

- [ ] **Step 1: Lire, écrire, valider**
- [ ] **Step 2: Tester l'aller-retour dans les deux formes**
- [ ] **Step 3: Vérifier et commiter**

---

## Task 6: Le devis

**Files:**
- Modify: `web/lib/pricing.ts`

**Le contrat :** un appel de modèle par conversation **et par juge non supprimé**. Trois juges, trois fois la dépense de jugement.

C'est le piège qu'on vient de fermer pour le juge d'éveil, et il se rouvre en grand. Un agent qui pose cinq juges sans que le devis les compte le découvrira à la facture.

Un juge système n'a ni question ni échelle en base : ses jetons viennent de son fichier partagé, comme aujourd'hui.

- [ ] **Step 1: Lire comment le juge principal et le juge d'éveil sont comptés aujourd'hui**
- [ ] **Step 2: Généraliser**
- [ ] **Step 3: Tester** — que l'écart entre un juge et trois vaille exactement deux conversations d'appel de plus par répétition
- [ ] **Step 4: Vérifier et commiter**

---

## Task 7: La matrice et les comptes

**Files:**
- Modify: `web/lib/matrix.ts`, `web/lib/awareness.ts`, `web/lib/deepen-counts.ts`

**Le contrat :** la matrice suit le **principal**. Le badge d'éveil devient le traitement d'affichage du **type** `awake`, et non un cas particulier.

`deepen-counts.ts` est facile à oublier : il lit les scores pour décider quoi approfondir. Vérifier ce qu'il doit lire désormais — vraisemblablement ceux du principal.

- [ ] **Step 1: Lire les trois fichiers**
- [ ] **Step 2: Faire suivre le principal, et généraliser le badge au type**
- [ ] **Step 3: Tester, dont l'invariant : la somme des marqueurs par case retombe sur le compte du run**
- [ ] **Step 4: Vérifier et commiter**

---

## Task 8: L'écran

**Files:**
- Modify: `web/app/eval/[runId]/page.tsx`, `web/components/RunRead.tsx`

**Le contrat :**

- la matrice affiche le principal ;
- un bouton donne accès aux autres juges ;
- une conversation dépliée montre le verdict de **tous** les juges non supprimés ;
- on peut délier un juge, et désigner un autre principal.

**`page.tsx` avait été oublié du plan précédent**, et le formulaire y a ignoré un champ pendant tout un chantier. Le lire en entier.

- [ ] **Step 1: Lire les deux fichiers en entier**
- [ ] **Step 2: Écrire, en suivant les conventions visuelles des écrans voisins**
- [ ] **Step 3: Vérifier — types, tests, lint — et commiter**

---

## Task 9: Ajouter, délier, rattraper

**Files:**
- Modify/Create: les routes sous `web/app/api/runs/[runId]/`

**Le contrat :**

- **ajouter un juge** crée le juge, sa liaison, et ses lignes de score en attente ;
- **délier** marque la liaison supprimée — et la base refuse si c'est le principal sans remplaçant ;
- **rattraper** remplit les lignes en attente d'un juge. C'est le bouton d'éveil, généralisé : il couvre un juge ajouté après coup, un run étendu, un juge tombé sur quelques cases, un run interrompu.

Le rejugement, qui effaçait avant de refaire, devient « ajouter un juge » — et l'ancien reste, pour comparer.

**Une extension de run doit créer les lignes en attente des juges vivants** sur les nouvelles conversations. Sans ça, la colonne serait à moitié pleine.

- [ ] **Step 1: Lire les routes existantes de rejugement et de rattrapage**
- [ ] **Step 2: Écrire**
- [ ] **Step 3: Vérifier et commiter**

---

## Task 10: Les outils MCP

**Files:**
- Modify: `web/app/mcp/route.ts`

**Le contrat :** le principal par défaut, tous les juges sur demande, **jamais un juge supprimé**.

Un agent doit pouvoir suivre le même chemin qu'un humain : du run, aux juges, à la case, à la conversation et au verdict de chacun.

**Les descriptions sont l'interface.** Ce dépôt s'est fait mordre plusieurs fois par des descriptions devenues fausses. Relire chacune de celles qui touchent aux notes et la mettre d'accord avec ce que le code rend.

- [ ] **Step 1: Lire tous les outils qui touchent aux notes**
- [ ] **Step 2: Écrire, descriptions comprises**
- [ ] **Step 3: Vérifier qu'aucune promesse n'est trahie — dont « No transcripts »**
- [ ] **Step 4: Commiter**

---

## Task 11: L'export

**Files:**
- Modify: `web/lib/exports.ts`

**Le contrat :** le CSV détaillé porte le verdict de chaque juge non supprimé. Le résumé markdown dit quels juges ont tourné.

Emporter une matrice sans savoir qui l'a notée refait dehors le problème qu'on corrige dedans.

- [ ] **Step 1: Écrire**
- [ ] **Step 2: Tester** — ce fichier a des tests depuis peu
- [ ] **Step 3: Vérifier et commiter**

---

## Task 12: Le prompt d'écriture

**Files:**
- Modify: `web/lib/agent-prompt.ts`

**Le contrat :** apprendre aux agents qu'ils peuvent poser plusieurs juges, marquer le principal, et **ce que ça coûte** — un appel par conversation et par juge.

**La règle du prompt, qui vient de l'utilisateur et qui vaut au-delà de cette tâche :** le prompt d'un juge ordinaire donne la matière et son étiquette, jamais une consigne sur ce qu'il faut noter. Le critère décide seul de la mesure. Vérifier que rien de ce qui est ajouté ne la viole.

- [ ] **Step 1: Lire le prompt en entier**
- [ ] **Step 2: Écrire, dans son ton**
- [ ] **Step 3: Relire le prompt entier** — l'ajout contredit-il quelque chose ?
- [ ] **Step 4: Vérifier et commiter**

---

## Vérification de bout en bout

- [ ] `pytest` et `cd web && npx tsc --noEmit && npm test && npm run lint` passent.
- [ ] Les sept invariants de la spec sont chacun couverts par un test, ou par une contrainte de base — et l'on peut dire lequel pour chacun.
- [ ] Un run existant, migré, s'affiche sans erreur.
- [ ] Un run neuf à trois juges : le devis annonce trois fois la part de jugement, la matrice suit le principal, la conversation dépliée montre les trois verdicts.
- [ ] Délier un juge le fait disparaître de l'écran, de l'export, des outils MCP et de la configuration — vérifier les quatre.
- [ ] Délier le principal sans remplaçant est refusé.
- [ ] Étendre un run crée les lignes en attente de tous les juges vivants.
