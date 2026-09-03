# Un run qu'on peut montrer

3 septembre 2026

## Le problème

Un run ne se montre pas. Tout ce qui le porte est derrière la porte : la page
`/eval/<id>`, les routes `/api` qui la nourrissent, et jusqu'au proxy qui
renvoie un visiteur anonyme vers l'écran de connexion. Pour faire lire une
matrice à quelqu'un qui n'est pas dans `ALLOWED_EMAILS`, il reste la capture
d'écran — c'est-à-dire un résultat qu'on ne peut ni vérifier, ni parcourir, ni
citer.

C'est gênant pour un collègue. Ça le devient plus encore pour un agent, qui est
le lecteur d'après : on veut lui donner une adresse et le laisser lire.

## Ce qu'on construit

Un run se publie depuis sa page. Il devient alors lisible à `/shared/<id>` par
quiconque a l'adresse, en lecture seule. Un second clic dépublie, et l'adresse
rend 404.

Rien n'est listé nulle part : la publication ouvre un run, pas l'application.

### La colonne, et où elle vit

Dans `polaris-supabase`, sous `evals/supabase/migrations/`, en PR séparée et
fusionnée d'abord — le reste ne tourne pas sans elle.

```sql
alter table public.eval_runs
  add column is_public boolean not null default false;

comment on column public.eval_runs.is_public is
  'Lecture seule hors session : /shared/<id> répond quand c''est vrai.
   Écrit par POST /api/runs/<id>/publish, jamais par le job.';
```

La table voisine `runs`, qui appartient à `cop-subtask-decomposition-evals` et
partage ce projet Supabase, porte déjà ce champ sous ce nom. On en reprend la
forme, et on en diverge sur un point que le commentaire dit : chez elle, aucun
code applicatif n'écrit la colonne. Ici, une route le fait.

### La porte, et la dette qu'on rembourse en passant

`/shared` doit sortir des exclusions du proxy, à côté de `prompt` et
`validate`. C'est exactement là qu'on vient de perdre une après-midi : `/validate`
avait été écrite « hors de la porte », le proxy ne l'avait pas apprise, et
l'appelant anonyme recevait l'écran de connexion — la même réponse, à l'octet
près, qu'une adresse qui n'existe pas. Rien ne le signalait : la route existait,
ses tests passaient.

La liste des chemins publics sort donc dans `web/lib/public-paths.ts`, avec la
fabrication du motif :

```ts
/** Ce qui ne passe pas par la porte. Répertoires, ancrés sur `/` ou la fin. */
export const OPEN_PREFIXES = [
  "api/auth",      // la connexion elle-même
  "prompt",        // le mode d'emploi de l'agent
  "validate",      // le vérificateur
  "shared",        // un run publié, et plus tard ce que l'agent y lira
  "_next/static",
  "_next/image",
];

/** Le motif du proxy. `favicon.ico` reste à part : c'est un fichier, ancré sur
 *  la fin exacte, quand tout le reste est un répertoire. */
export function proxyMatcher(): string;
```

`proxy.ts` n'écrit plus son expression régulière à la main ; il l'appelle. Un
chemin ouvert ajouté sans exclusion devient un test rouge au lieu d'un silence.
L'ancrage de chaque entrée ne bouge pas, et c'est lui que le test tient :
`/validate` et `/shared/<id>` ouverts, `/validatex`, `/prompts-secrets` et
`/sharedx` fermés.

### La page publique n'est pas la page privée avec un drapeau

`web/app/shared/[runId]/page.tsx`, composant serveur, distinct des 1374 lignes
de `/eval/[runId]`. Il lit par le rôle de service, rend `notFound()` si le run
n'est pas public, et affiche la matrice, la configuration, les conversations et
les notes.

La lecture seule est alors une propriété du fichier : aucun chemin d'écriture
n'y existe. Passer un `readOnly` dans la page existante ferait dépendre la
sûreté du fait que chaque bouton futur y pense — et cette page en a une
quinzaine. Le rendu des cases vit déjà dans `lib/rubric.ts`, pur : la page
publique le réutilise sans toucher à la grosse.

Elle refuse par elle-même. Le proxy ne fait qu'aiguiller, il ne prouve rien —
même discipline que `requireUser`, qui est le seul contrôle d'accès des routes
`/api` alors que le proxy les couvre déjà.

### Ce qui ne sort pas tient dans une fonction

```ts
/** Un run tel qu'un inconnu peut le lire. */
export function withoutIdentity(detail: RunDetail): RunDetail;
```

Pure, dans `lib/`, testée : `user_email` disparaît, et **tout le reste passe** —
les notes du run, la note privée de chaque scénario, le CSV source. C'est une
décision, prise en sachant que ces champs ont été écrits en supposant que
personne d'autre ne les lirait. Le test l'écrit en toutes lettres, pour que
personne ne « corrige » ça par réflexe dans six mois.

Publier n'est pas un état de la donnée mais un geste : c'est au moment du clic
qu'on accepte ce qui sort, et la confirmation le nomme.

### Publier

`POST /api/runs/[runId]/publish`, gardée par `requireUser` comme les autres,
corps `{ public: boolean }`, rend l'URL publique.

Sur la page du run : un bouton, et une confirmation qui liste ce qui devient
lisible — les notes comprises. `ConfirmDialog` et `ConfirmRows` existent et
servent déjà à ça ailleurs.

L'adresse est l'identifiant du run, un UUID v4 : non listé, non devinable,
aucun jeton à gérer ni à faire expirer. Dépublier suffit à tuer le lien.

## Ce qui vient après, et ce que ça impose ici

Le lecteur d'après est un agent. On lui donnera l'adresse du run, et il devra
pouvoir lire seul : d'abord ce qu'est ce run et quelles autres adresses il peut
appeler, puis les résultats courts, puis les trajectoires complètes — jamais
tout d'un coup, pour qu'il choisisse ce qu'il charge.

Ce spec ne construit pas ces endpoints. Il fixe ce qui les rendra additifs :

**L'espace d'adressage.** Tout vit sous `/shared/<id>`, une seule exclusion pour
la porte. Les endpoints de l'agent y seront des enfants — le contexte, les
résultats courts, les résultats avec trajectoires — et non des `/api/…`. Ce
n'est pas un détail de goût : `/api/*` répond 401 en JSON aux anonymes, et le
dépôt place déjà hors de `/api` ce qui s'adresse à une machine sans session,
`prompt` et `validate` en témoignent.

**Le point de passage.** `loadPublicRun(runId, { withTranscripts })` refuse un
run non public et applique `withoutIdentity`. La page l'utilise dès maintenant ;
les endpoints l'utiliseront ensuite. Une seule fonction décide qui lit quoi, et
`withTranscripts` existe déjà dans `loadRun` — c'est la coupure « court /
complet » que l'agent demandera.

**Le geste de partage.** Le bouton d'après sera « copier le lien pour un agent »,
et il publiera le run si besoin, après l'avoir dit. La confirmation écrite ici
est donc celle qu'il réemploiera : elle est écrite pour être appelée d'ailleurs.

## Ce qui n'y est pas

Pas d'index public, pas de téléchargement — les routes d'export restent gardées
—, pas de jeton, pas d'expiration, pas de trace de consultation. Chacun de ces
manques est un choix, et aucun n'est bloqué par ce dessin.

## Comment on vérifie

| ce qu'on fait | ce qu'on doit voir |
|---|---|
| `/shared/<id>` d'un run non publié, sans session | 404, et rien du run |
| le même une fois publié | la matrice, la config, les conversations, les notes |
| `user_email` dans la réponse | nulle part |
| dépublier, recharger | 404 de nouveau |
| `/eval/<id>` sans session | toujours l'écran de connexion |
| `POST /api/runs/<id>/publish` sans session | 401 |

Deux fonctions pures portent les règles et se testent dans `lib/` :
`withoutIdentity`, qui retire l'adresse et rien d'autre, et `proxyMatcher`, qui
ouvre chaque chemin de la liste et referme ses voisins de préfixe.

Le reste se vérifie à l'œil et au `curl`, faute de banc d'essai pour les
composants — et le `curl` compte double ici, puisque c'est en le faisant qu'on a
découvert que `/validate` n'avait jamais été joignable.
