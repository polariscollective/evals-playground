# Vercel, Supabase, Cloud Run — design

20 août 2026

## Le problème

L'application ne tourne que sur le portable de son auteur. Le backend FastAPI
lance des sous-process qui vivent des heures, écrit dans `data/eval-runs/`, et
garde ses poignées de process en mémoire. Rien de tout cela ne survit à un
déploiement, et rien n'est partageable : un run n'existe que sur la machine qui
l'a lancé.

On veut l'inverse : l'interface accessible depuis un navigateur, les runs
visibles par toute l'équipe, et l'exécution ailleurs que sur un portable.

## L'architecture visée

C'est celle de `cop-subtask-decomposition-evals`, dont ce projet reprend les
conventions plutôt que d'en inventer d'autres.

```
Vercel — Next.js
  pages (client)  ──►  app/api/*  (TypeScript)
                          │  auth : Google + liste d'autorisation
                          │
                          ├──► Supabase          lecture / écriture
                          │
                          └──► POST BATCH_TRIGGER_URL
                                   Authorization: Bearer <secret partagé>
                                        │
Cloud Run — polaris-batch-trigger  ◄────┘
  valide le secret, appelle l'API Cloud Run Jobs avec son identité GCP
                                        │
Cloud Run Job — evals-playground-runner │
  python -m playground.batch_job   ◄────┘
  inspect_ai, écrit chaque échantillon dans Supabase au fil de l'eau
                                        │
Supabase  ◄─────────────────────────────┘
  eval_runs · eval_samples
```

Le navigateur ne parle jamais à Supabase. La clé de service ne quitte jamais le
serveur — routes Next.js et job, tous deux côté serveur.

## Ce qui disparaît

`backend/playground/eval_api.py`, `api.py`, `catalog.py`, `eval_store.py`,
`exports.py`, `migrations.py`, et le stockage sur disque avec eux. FastAPI n'est
plus déployé nulle part : son rôle — valider, appeler, sérialiser — est repris
par les routes Next.js, qui ont l'avantage d'être là où vit déjà la session de
l'utilisateur.

Python garde ce que TypeScript ne peut pas faire : le moteur d'évaluation.
`conversation.py`, `eval_task.py`, `scoring.py`, `matrix.py`, `pricing.py`,
`eval_schemas.py`, plus un nouveau `supabase_store.py` et le point d'entrée
`batch_job.py`.

## Le schéma

Deux tables, dans le projet Supabase `evals` déjà utilisé par COP. Le préfixe
`eval_` les tient à l'écart de ses `runs`, `batches`, `scenarios`.

**Les migrations ne vivent pas dans ce dépôt** mais dans `polaris-supabase`, qui
possède le schéma des bases de l'organisation. L'historique de migration d'une
base Postgres est unique, et la CLI Supabase refuse de pousser depuis un dépôt
dont le dossier de migrations ne couvre pas tout l'historique distant : deux
applications ne peuvent donc pas migrer la même base chacune de son côté. Le
prix de ce choix est une PR de plus par changement de schéma.

```sql
create table eval_runs (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  user_email     text not null,
  label          text,
  status         text not null default 'pending'
                 check (status in ('pending','running','done','error','cancelled')),
  error          text,
  config         jsonb not null,
  notes          text not null default '',
  source_csv     text,
  total_samples  integer not null,
  usage          jsonb not null default '{}'::jsonb,
  cost_usd       numeric(12,6),
  rejudged_at    timestamptz,
  execution      text
);

create table eval_samples (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references eval_runs(id) on delete cascade,
  scenario_index integer not null,
  scenario_title text not null default '',
  target_model   text not null,
  repetition     integer not null,
  status         text not null default 'pending'
                 check (status in ('pending','running','done','error')),
  temperature    numeric,
  score          numeric,
  justification  text not null default '',
  messages       jsonb not null default '[]'::jsonb,
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  unique (run_id, scenario_index, target_model, repetition)
);
```

Une ligne par scénario × modèle évalué × répétition. C'est la granularité de la
matrice : une case en est un regroupement, pas une ligne de plus.

**Les lignes sont toutes créées au lancement**, en `pending`. Le job ne fait que
les passer à `running` puis à `done`. Conséquence directe : « combien reste-t-il
à faire » est un `count(*) where status = 'pending'`, connu avant même que le
job démarre, et la matrice s'affiche grisée dès la première seconde plutôt que
de se construire case par case.

La configuration complète — scénarios, échelle, prompts, modèles — reste dans
`eval_runs.config`, en un seul JSON. La dupliquer sur chaque échantillon
alourdirait la table de plusieurs kilo-octets par ligne pour une information qui
ne varie pas.

### Grants et RLS

Le projet Supabase porte un event trigger `ensure_rls` qui active RLS sur toute
table créée dans `public`, sans aucune politique. L'accès passe donc entièrement
par la clé de service, qui contourne RLS — et les droits doivent être accordés
explicitement, comme le fait déjà la migration `grant_service_role_privileges`
de COP :

```sql
grant select, insert, update, delete on public.eval_runs, public.eval_samples
  to service_role;
```

### Runs abandonnés

Un job qui meurt sans rien dire laisserait un run en `running` pour toujours.
Une fonction SQL les termine :

```sql
create function fail_stale_eval_runs() returns integer ...
```

Elle passe en `error` tout run non terminal dont `updated_at` remonte à plus de
deux heures, et avec lui ses échantillons non terminés.

**Sur `updated_at`, pas sur `started_at`** — un écart avec la consigne initiale,
assumé : le job touche une ligne toutes les quelques secondes, donc deux heures
sans le moindre écrit signifie qu'il est mort. Compter depuis le démarrage
tuerait une grosse matrice encore bien vivante, ce qui est exactement l'erreur
qu'on ne veut pas.

La fonction est appelée par les routes de lecture, à chaque liste et à chaque
détail. C'est idempotent et sans coût mesurable, et ça ne dépend d'aucune
extension : `pg_cron` n'est pas activé sur ce projet.

## L'authentification

Auth.js avec Google pour seul fournisseur, et `isAllowedEmail` en garde — la
même fonction que COP, à la virgule près :

```
ALLOWED_EMAILS   verboomensamuel@gmail.com
ALLOWED_DOMAINS  polariscollective.org
```

Un middleware ferme tout sauf `/api/auth`. Les pages non authentifiées partent
vers l'écran de connexion, les routes d'API répondent 401.

`LOCAL_AUTHENTICATION_NEEDED=false` court-circuite la connexion en
développement, verrouillé sur `NODE_ENV !== "production"` pour que ce ne soit
jamais activable sur un déploiement — repris tel quel de COP, y compris le
double verrou.

**Les runs sont attribués** à l'adresse de la session, jamais à ce que le client
prétend. Tout le monde voit tous les runs : l'attribution sert à savoir qui a
lancé quoi, pas à cloisonner.

## Ce qui doit être porté en TypeScript

Trois choses vivaient en Python et sont appelées avant qu'un run n'existe, donc
avant que le job ne tourne : le devis, l'aperçu du prompt du juge, le catalogue
des modèles.

Les porter, c'est risquer que les deux versions divergent — et un devis faux ou
un aperçu qui ne correspond pas au prompt réellement envoyé sont deux mensonges
silencieux. D'où un dossier `shared/`, lu par les deux langages :

```
shared/pricing.json        tarifs, longueurs de réponse mesurées, catalogue
shared/judge-prompt.json   message système et gabarit du message utilisateur
```

Python et TypeScript ne portent plus que le rendu, pas les données. Un test
Python vérifie que le gabarit rendu correspond à ce que le juge reçoit
réellement ; le rendu TypeScript est vérifié contre les mêmes cas.

## Repasser le juge

Une passe de juge ne rappelle que le juge : les transcripts sont déjà en base,
et c'est eux qui coûtent cher. Elle réécrit `score` et `justification` de chaque
échantillon, jamais `messages`.

Elle est franchement destructive, et le dit : au lancement, la route remet à
zéro `score` et `justification` de tout le run, et le repasse en `running`.

L'atomicité qu'on aurait pu vouloir — une passe ratée laisse les anciennes
notes intactes — n'est plus atteignable avec l'écriture au fil de l'eau : la
première case reçoit sa nouvelle note pendant que la cinquantième porte encore
l'ancienne. Entre un mélange silencieux de deux échelles et des trous francs, ce
sont les trous qui se voient.

## L'export CSV

La matrice devient une moyenne par case, comme à l'écran. L'export détaillé
change de forme avec la table : une ligne par échantillon, ce qu'il est déjà
devenu en base. Les colonnes de run — critère, échelle, notes, coût — restent
répétées pour l'instant ; c'est le point 7 du to_do, à reprendre à part.

## Le déclencheur

Le proxy passe dans son propre dépôt, `polaris-batch-trigger`, et devient
générique : il accepte un nom de job et une map de variables d'environnement, au
lieu de connaître les pipelines d'un projet précis.

C'est le bon domicile pour une pièce partagée. `cop-batch-trigger` reste en
place et intact ; rien n'oblige COP à migrer, et le jour où il le fera, ce sera
un changement d'URL.

L'IAM borne ce qu'un appelant peut lancer : le compte de service du proxy n'a
`roles/run.developer` que sur les jobs qu'on lui a nommément accordés. Un
paramètre `job` libre reste donc sans danger.

## Terraform

Un fichier `environments/app/evals_playground_batch.tf` calqué sur
`cop_batch.tf` :

- `google_cloud_run_v2_job.evals_playground_runner` — image Python, timeout 24 h
- `google_service_account.evals_playground_runner` + accès aux secrets
- `google_cloud_run_v2_service.polaris_batch_trigger` + son compte de service
- `roles/run.developer` du proxy sur notre job
- deux secrets neufs : `OPENAI_API_KEY`, `XAI_API_KEY`

Les secrets Supabase existants s'appellent `COP_SUPABASE_URL` et
`COP_SUPABASE_SERVICE_ROLE_KEY`. On les réutilise tels quels : c'est le même
projet Supabase, et créer un doublon signifierait deux valeurs à faire tourner
ensemble. Le nom devient trompeur — un commentaire le dit.

Dans le seed, `deploy_github_repos` gagne `evals-playground` et
`polaris-batch-trigger`. Le seed s'applique localement, par un admin connecté en
`admin@polariscollective.org` : ce n'est pas la CI qui le fera.

## Lancer un run en développement

La route de lancement écrit le run et ses échantillons dans Supabase, puis
appelle `BATCH_TRIGGER_URL`. Sans cette variable, et hors production seulement,
elle lance le job en sous-process local — même verrou que le court-circuit
d'authentification. C'est ce qui garde l'application utilisable sans GCP, sans
introduire de seconde forme de stockage.

## Hors périmètre

- La génération de scénarios (`/creer`, `/scenarios`, `/juges`) : ces pages
  n'existent pas, seuls leurs liens de navigation subsistent.
- L'export complet du to_do, point 7.
- Migrer les 6 runs locaux : ce sont des essais, ils restent sur le disque.
- Faire basculer COP sur le proxy partagé.
