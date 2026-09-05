# Les logs d'Inspect : produits à chaque run, jetés à chaque run

5 septembre 2026

## Le problème

Chaque run d'évaluation écrit un vrai journal Inspect. `batch_job.py:308` passe
`log_dir=logs/eval/<run_id>` à `inspect_eval`, et Inspect y dépose un `.eval`
complet : un `ModelEvent` par appel de modèle — cible, adversaire, juge — avec
les messages d'entrée, la sortie, les outils appelés, les retries, le temps ;
`model_usage` par échantillon, cache lu et écrit compris ; les spans du solver,
l'événement `score`, les erreurs.

C'est plus riche que ce qui va en base. Supabase garde le transcript reconstruit
du point de vue de la cible ; le `.eval` garde *chaque appel tel qu'il est
parti*, y compris la vue miroir de l'adversaire et le prompt du juge.

Personne ne l'a jamais lu. `LOGS_DIR` vaut `logs/eval` par défaut, donc dans le
job Cloud Run le fichier s'écrit sur le disque du conteneur, qui meurt avec lui.
Le docstring de `run_batch_job` l'assume à demi-mot — « Éphémère dans un
conteneur : ce qui compte est en base, pas ici » — mais ce qui est ici n'est pas
rien : c'est la seule trace de ce qui s'est réellement passé au niveau des
appels.

S'y ajoute un défaut d'appréciation. Inspect est traité dans ce dépôt comme une
dépendance de conformité : la boucle de conversation, la reprise, le juge, la
matrice, le stockage et l'interface sont écrits ici. Ce qu'Inspect gagne
réellement sa place à faire tient en trois points — passerelle vers les trois
fournisseurs, comptabilité des jetons par échantillon, et le format `.eval`
avec son viewer. Le troisième est aujourd'hui entièrement non réclamé. Le
brancher est ce qui fait passer Inspect de dette à outil.

## Ce qu'on construit

```
Cloud Run Job (batch_job)
  écrit  logs/eval/<run_id>/*.eval        disque éphémère, inchangé
  puis, en `finally` :  POST chaque .eval → Supabase Storage
                        bucket `inspect-logs`, chemin <run_id>/<nom>.eval

Vercel
  /eval/<runId>                            bouton « View Inspect AI logs »  (auth)
  /shared/<runId>                          le même bouton, si is_public
  /inspect-view/assets/*                   9,9 Mo d'assets commités → CDN
  /inspect-view/<runId>                    l'index.html du viewer, log_dir absolu → ↓
  /inspect-view/<runId>/logs/listing.json  route : liste les objets du run
  /inspect-view/<runId>/logs/<nom>.eval    route : proxy Storage, Range transmis, 206
```

**Un run a plusieurs `.eval`, et c'est un gain.** `batch_job` écrit dans
`logs_dir/<run_id>`, donc chaque passe — run initial, rejugement,
approfondissement — y dépose son propre fichier horodaté. Le `listing.json` du
viewer les montre tous. L'historique des passes d'un run devient lisible, là où
la base ne garde que l'état final.

**Le `finally`, pas la fin du chemin heureux.** Inspect écrit le `.eval` au fil
de l'eau : un job qui meurt laisse un log partiel, précisément le cas où on veut
le lire. Le `try` de `run_batch_job` (ligne 239) couvre déjà le retour anticipé
de l'annulation et le `except` final ; un `finally` sur ce même `try` attrape
les trois sorties.

## Les composants

**`backend/playground/log_store.py`** — module neuf, une fonction publique :
`upload_logs(storage, run_id, logs_dir)`, qui pousse chaque `.eval` du dossier
vers `POST /storage/v1/object/inspect-logs/<run_id>/<nom>.eval`. Même forme que
`supabase_store.Supabase` — httpx, clé de service, client injectable pour que
les tests n'aient ni réseau ni base. Module séparé plutôt qu'ajout à
`supabase_store.py` : Storage n'est ni le même service ni la même forme d'URL
que PostgREST, et ce fichier fait déjà 376 lignes sous un nom qui promet des
tables.

Une règle gouverne ce module : **un envoi raté ne fait jamais échouer un run
réussi.** Il s'écrit sur `stderr` et s'arrête là. Un run dont la matrice est
complète et notée est un run réussi ; perdre son log est ennuyeux, le marquer
`error` serait faux. La règle vaut aussi pour un `.eval` qui dépasse le
`file_size_limit` du bucket.

Le docstring de `logs_dir` cesse d'être vrai et se corrige dans la foulée.

**`web/lib/storage.ts`** — à côté de `web/lib/supabase.ts` et dans le même
style : `listRunLogs(runId)` et `fetchRunLog(runId, name, range)`.

**`web/app/inspect-view/[runId]/route.ts`** — lit
`web/public/inspect-view/index.html`, réécrit `./assets/` en
`/inspect-view/assets/` et pose `log_dir` sur `/inspect-view/<runId>/logs`. Des
chemins absolus, pour que la barre oblique finale ne décide de rien.

**`web/app/inspect-view/[runId]/logs/[...path]/route.ts`** — `listing.json`
fabriqué depuis la liste Storage, et le `.eval` proxifié en transmettant `Range`
et en rendant 206.

**`scripts/build-inspect-view.sh`** — rejoue `inspect view bundle` et dépose les
assets dans `web/public/inspect-view/`. Son résultat est commité : 9,9 Mo sur
disque, ~3 Mo une fois compressés par git, à rejouer quand `inspect-ai` monte
de version.

**La migration `polaris-supabase`** — le bucket `inspect-logs`, **privé**, avec
`file_size_limit` à 50 Mo — le plus gros log observé pèse 977 Ko pour 72
cases, donc cinquante fois la marge, et c'est la limite par défaut de Supabase
Storage. Un bucket public suffirait à contourner `is_public` :
c'est la moitié du contrôle d'accès, et elle ne vit pas dans ce dépôt.

## Pourquoi un proxy et pas une URL signée

Le `.eval` est un ZIP zstd — 84 entrées sur le log examiné, un JSON par sample
plus un journal — et le viewer le lit **par requêtes Range** : 562 occurrences
de `Range`/`bytes=` dans son `index.js`. Il ne télécharge jamais le fichier
entier ; il lit le central directory, puis l'entrée voulue. Ce qui sert le log
doit donc gérer `Range` et rendre 206.

Supabase Storage sert bien les Range, et une URL signée serait plus rapide.
Deux raisons de ne pas la prendre. Le viewer résout `log_file` à travers sa
couche `api`, relative à la page (`openRemoteLogFile(api,
encodePathParts(log_file))`) : qu'une URL absolue cross-origin passe n'est pas
établi. Et une URL signée sortirait les octets du contrôle de l'application.

## Le contrôle d'accès

`canReadRun(runId)` : session valide via `requireUser()`, **ou** `is_public`.
Les deux routes l'appellent en première ligne. C'est la règle de `loadPublicRun`
(`web/lib/runs.ts:514`) réécrite une fois, pas deux.

Le log suit donc la publication du run : privé quand le run l'est, partagé quand
il est publié. Pas de drapeau supplémentaire — `eval_runs.is_public` existe déjà
et `setPublic` l'écrit. C'est cohérent avec le principe déjà posé dans
`web/app/shared/[runId]/page.tsx` : la lecture publique n'a jamais eu de raison
d'être plus pauvre que la privée.

Les assets, eux, ne disent rien de personne et restent en CDN nu.

## Cas limites

**Un run sans log.** Tous les runs déjà en base n'en ont aucun, et un job mort
tôt n'en a pas non plus. Le bouton ne s'affiche que si `listRunLogs(runId)` rend
quelque chose — un appel HTTP de plus au rendu de la page, à côté de ceux
qu'elle fait déjà. Pas de colonne `has_logs`, donc pas de migration de plus, et
rien à rétro-remplir : l'absence se lit à la source.

**Pas de rétention, délibérément.** Rien ne supprime un run aujourd'hui — ni
route `DELETE`, ni `deleteRun`. Donc pas de logs orphelins à ramasser, et
inventer une politique d'expiration pour un bucket vide serait deviner. À revoir
quand le bucket pèsera quelque chose.

## Tests

`tests/test_log_store.py` — client httpx factice : le chemin construit, les
en-têtes, `x-upsert`, et surtout qu'une réponse 500 ne lève pas.

`tests/test_batch_job.py` — un test qui fait planter le run et prouve que
l'envoi a quand même eu lieu. Le `finally` est la partie fragile du chantier ;
c'est lui qui doit être tenu par un test, pas le chemin heureux.

`web/lib/storage.test.mts` — suit la convention du dépôt, `node --test
"lib/**/*.test.mts"`. Les routes ne sont pas testées ici et ce chantier
n'introduit pas de harnais pour deux handlers : la logique testable est dans
`lib/`, les routes n'aiguillent.

## Le point non prouvé

Que le viewer accepte un `log_dir` en chemin absolu. Toute la route `[runId]`
repose dessus et le JS est minifié — première tâche du plan, un pointage sur le
bundle local. S'il refuse, le repli est de servir sous `/inspect-view/<runId>/`
avec une redirection 308 des assets vers les statiques : plus laid, sans
inconnue.

## Ce que ce chantier ne fait pas

Pas de politique de rétention. Pas de colonne en base. Pas de lien case par case
— le viewer s'ouvre sur le run, pas sur une case. Rien pour les runs déjà
passés, qui n'ont pas de log à montrer.
