# Un connecteur MCP pour evals-playground

3 septembre 2026

## Le problème

Aujourd'hui, faire écrire un run par un agent tient en deux allers-retours
manuels : je donne le lien vers `/prompt`, l'agent le lit, écrit un YAML, je le
colle dans `/validate` jusqu'à ce que ça passe, puis je le colle une deuxième
fois dans l'application pour lancer. Et une fois le run terminé, l'agent ne
peut rien en relire lui-même — sauf s'il est publié, ce qui est l'exception,
pas la règle.

Le spec du run public l'avait anticipé sans le construire : *« le lecteur
d'après est un agent [...] d'abord ce qu'est ce run, puis les résultats
courts, puis les trajectoires complètes »*. Ce spec-ci construit cette
lecture, plus la partie qui manquait encore : sauvegarder un YAML sans le
lancer, et rendre tout ça joignable depuis claude.ai comme connecteur — donc
avec une vraie identité, pas juste des routes ouvertes comme `/prompt`.

## Ce qu'on construit

```
claude.ai  →  /mcp                                    (le protocole MCP)
           →  /mcp/authorize, /mcp/token, /.well-known/…
                                                        (OAuth pour s'y connecter)
```

Ça vit dans `evals-playground`, à côté de `/prompt` et `/validate` : des
machines sans cookie de session, qui s'autorisent elles-mêmes plutôt que de
compter sur le proxy.

### L'identité : un serveur d'autorisation qui ne vérifie l'identité de personne

MCP demande un vrai flux OAuth pour qu'un connecteur distant se « connecte » —
pas un jeton collé à la main, et il en va d'une vraie différence : c'est ce
flux qui donne une identité *par personne*, quand un jeton partagé (l'option
« request headers » de claude.ai) ne distinguerait plus qui, dans l'équipe,
fait la demande. On ne réinvente pas de vérification d'identité pour autant :
`/mcp/authorize` renvoie vers l'écran de connexion déjà en place — la session
NextAuth existante, donc `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` et
`isAllowedEmail` tels qu'`auth.ts` les applique déjà. Une fois la session
là, `/mcp/token` émet un jeton MCP propre, sans rapport avec le cookie de
session NextAuth.

Pas d'enregistrement dynamique de client (DCR) : `client_id` est fixe —
`MCP_CLIENT_ID` — saisi à la main à l'ajout du connecteur dans claude.ai
(« Use your own OAuth client »), ce que permet un connecteur qui n'est jamais
distribué à d'autres organisations. Une table de clients devient donc inutile.

Deux tables neuves, dans `polaris-supabase` sous `evals/supabase/migrations/`,
en PR séparée et fusionnée d'abord — comme pour `is_public`, rien ici ne tourne
sans elles :

```sql
create table public.mcp_auth_codes (
  code_hash text primary key,
  user_email text not null,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.mcp_tokens (
  access_token_hash text primary key,
  refresh_token_hash text not null unique,
  user_email text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

Chaque appel d'outil résout son jeton en `email` : un jeton inconnu ou expiré
rend l'erreur MCP attendue, un jeton valide retombe sur le même `email` que
produirait une session normale, et donc sur les mêmes fonctions de
`lib/runs.ts` que le reste de l'application — aucun code de lecture n'est
dupliqué pour l'agent.

Une petite page de réglages liste les autorisations actives par email et
permet de révoquer une ligne de `mcp_tokens` : couper l'accès ne doit pas
dépendre de claude.ai de l'autre côté.

Le transport HTTP de MCP et la vérification du jeton porteur (le 401 avec
`WWW-Authenticate`, les métadonnées de ressource protégée) s'appuient sur
`mcp-handler`. Ce qu'aucun paquet maintenu ne fournit, en revanche, c'est le
serveur d'autorisation lui-même — celui qui *émet* les codes et les jetons :
le SDK MCP l'a scindé fin juillet, et la seule implémentation qui en tenait
lieu ne vit plus que dans un paquet gelé, avec l'avertissement de ne pas s'en
servir en production. `/mcp/authorize` et `/mcp/token` sont donc écrits ici,
protocolaires plutôt que produit, et c'est le plus gros morceau du projet.

### Les cinq outils

| outil | rend | source |
|---|---|---|
| `read_prompt` | le contenu de `/prompt` | inchangé, juste appelable sans lien à coller |
| `submit_draft_run` | une URL de brouillon + le verdict de coût | `configProblem` / `verdictOf`, **avant** toute écriture |
| `get_run_metadata` | le run sans ses cases : label, statut, coût, modèles, notes, `is_public` | `loadRun`, sans les `samples` |
| `get_run_results` | la matrice — une ligne par scénario, la moyenne par modèle, le nombre de répétitions comptées | `lib/matrix.ts`, la même fonction que la page privée, pas les `samples` bruts |
| `get_run_trajectory` | la conversation d'**une seule case** (scénario × modèle × répétition) | une fonction neuve, ciblée, qui ne lit que cette ligne |
| `search_runs` | les runs récents, ou ceux dont le texte porte un mot : une fiche courte et l'extrait qui correspond | `loadRuns`, puis une fonction pure de `lib/` — aucune requête neuve |

Aucun outil ne lance de run — confirmé, ça reste un clic humain.

**`search_runs` revient sur une décision de ce dessin, et sciemment.** La
version d'origine n'offrait aucun moyen de lister : l'humain donnait
l'identifiant, et l'application ne devenait pas un répertoire. À l'usage, ça
oblige à savoir d'avance quel run on cherche — alors que la question qu'on pose
vraiment à un agent est « as-tu déjà vu un run qui parlait de ça ? ». La
recherche répond à celle-là.

Ce qu'on lui concède reste borné : elle ne rend qu'une fiche courte par run,
jamais les notes entières ni la matrice — l'agent rappelle
`get_run_metadata` ou `get_run_results` sur les deux ou trois qu'il retient.
C'est le même partage que le reste des outils : il choisit ce qu'il charge.
Et elle ne montre rien qu'un humain connecté ne voie déjà sur `/runs`.

Le filtrage se fait en TypeScript et non en SQL, sur ce que `loadRuns` a déjà
ramené. Trois raisons plutôt qu'une : le mot-clé de l'agent ne touche jamais
une expression de filtre PostgREST, donc rien à assainir ; la logique de
correspondance et de découpe d'extrait devient une fonction pure, donc l'une
des rares parties de ce connecteur que `node --test` couvre vraiment ; et
aucune requête n'est à écrire. Le prix est de lire tous les runs pour n'en
rendre que dix, ce que la page `/runs` fait déjà à chaque chargement. Le jour
où ça pèse, le remède est une vue d'agrégation en base — pas un index
bricolé ici.

`get_run_trajectory` mérite sa propre requête plutôt que de réutiliser
`loadRun(..., { withTranscripts: true })` et de découper après coup : un run
de taille ordinaire porte des dizaines de conversations, et les charger toutes
pour n'en rendre qu'une serait le genre de coût caché qui ne se voit qu'en
production. La fonction neuve sélectionne directement la ligne d'`eval_samples`
demandée.

### `read_prompt` ne rend pas ce que rend `/prompt`

Le tableau ci-dessus disait « inchangé, juste appelable sans lien à coller ».
C'est faux, et ça se voyait à l'usage : l'agent branché en MCP recevait
l'adresse absolue de `/validate` et allait y frapper, alors qu'il avait
`submit_draft_run` dans la main.

Les deux documents décrivent le même format et les mêmes règles — c'est un seul
gabarit, `TEMPLATE`, et il doit le rester : deux copies dériveraient en silence
le jour où `configProblem` change. Mais ils ne s'adressent pas au même lecteur.

`/prompt` est lu par un humain qui le colle chez un agent nu. La seule prise de
cet agent sur l'application est HTTP, d'où l'origine absolue et un `POST
/validate` ; il rend le YAML, et c'est l'humain qui le transporte.

`read_prompt` est lu par un agent qui a déjà les outils. Quatre passages
divergent, remplis par `agentPrompt` ou par `mcpAgentPrompt` :

| trou | canal HTTP | canal MCP |
|---|---|---|
| `{{CHECK}}` | `POST /validate`, puis écrire le document complet | `submit_draft_run`, un seul appel, sur le document complet |
| `{{SAMPLE}}` | « seule l'étape de vérification travaille sur une poignée » | il n'y a plus d'étape courte |
| `{{CSV}}` | la forme `scenarios: from csv`, et le téléversement séparé | ce canal ne porte pas de CSV — écrire les scénarios |
| `{{CLOSING}}` | `REPLACE THIS LINE`, que l'humain édite avant de coller | l'expérience est déjà dans la conversation |

**L'étape de vérification courte disparaît en MCP.** Elle existait pour deux
raisons, et les deux tombent : la limite de longueur du GET n'a plus cours, et
un document refusé ne coûte qu'un aller-retour puisque l'erreur sort avant
`createDraft` — rien n'est écrit. Un document court *accepté*, lui, poserait un
brouillon à jeter et rendrait une URL qui n'est pas la bonne. L'agent écrit donc
tout, et appelle une fois.

**Le CSV n'est pas offert en MCP** parce que l'outil le refuse : un document qui
annonce un CSV rend `INCOMPLETE`, et `submit_draft_run` traite ça en erreur —
un brouillon dont les scénarios manquent n'est pas un brouillon. Le tableur reste
un chemin, mais c'est celui du formulaire web.

**La description de `submit_draft_run` met la garantie en premier.** Un agent
qui craint de dépenser l'argent de quelqu'un n'appelle pas l'outil et se rabat
sur ce qu'il croit inoffensif — c'est-à-dire `/validate`, exactement ce qu'on
vient de lui retirer. Le titre ne commence donc plus par « Submit », et le corps
dit avant tout le reste que rien n'est exécuté, qu'aucun modèle n'est appelé,
qu'un refus n'écrit rien et qu'un succès rend le coût estimé. C'est un
validateur qui laisse une trace adressable, pas un bouton de lancement.

### Le brouillon, une table à part

`eval_runs` n'a pas d'état « pas encore lancé » — une ligne qui existe a déjà
`triggered`. Un brouillon est donc un objet différent, pas un run au repos :

```sql
create table public.eval_run_drafts (
  id uuid primary key default gen_random_uuid(),
  config jsonb not null,
  csv_text text,
  created_by text not null,
  created_at timestamptz not null default now()
);
```

`submit_draft_run` y écrit et rend `${origin}/runs/drafts/<id>`. Cette page,
`web/app/runs/drafts/[draftId]/page.tsx`, se lit avec une session normale —
c'est un humain qui clique, pas l'agent. Elle affiche le YAML reçu et le même
verdict de coût que `/validate`, avec un bouton « Lancer » qui appelle
exactement le chemin `createRun` + `startJob` que `POST /api/runs` utilise
déjà. Une fois lancé, le brouillon est effacé — son rôle s'arrête là où
commence celui du run.

Un balayage périodique, dans l'esprit de `fail_stale_eval_runs`, efface les
brouillons non lancés après sept jours : sans lui, un agent qui essaie
plusieurs formulations avant de trouver la bonne laisserait des déchets
permanents.

### La porte

Deux entrées de plus dans `OPEN_PREFIXES` (`web/lib/public-paths.ts`) :
`mcp` et `.well-known`. Comme pour `shared`, ouvrir le chemin n'autorise
rien — ça enlève seulement le renvoi vers l'écran de connexion HTML, qui
n'aurait aucun sens pour un client MCP. C'est `requireMcpUser` qui fait
autorité derrière, exactement comme `loadPublicRun` la fait pour `/shared`. Le
littéral de `proxy.ts` doit être mis à jour à la main en même temps, pour la
raison déjà connue : `matcher` doit rester une constante analysable à la
compilation, et le test d'accord entre les deux existe déjà pour attraper un
oubli.

## Ce qui n'y est pas

Pas d'outil pour lancer un run depuis l'agent, pas de suppression d'un
brouillon par l'agent lui-même, pas de rafraîchissement de jeton géré à la
main — le SDK MCP s'en charge côté client. Pas de recherche plein-texte non
plus : `search_runs` cherche une sous-chaîne, pas des mots apparentés, et ne
sait pas classer par pertinence — d'où son tri par date, qui ne prétend rien.
Un vrai `tsvector` avec son index GIN est l'étape d'après, et elle demandera
une migration. Chacun de ces manques est un choix, aucun n'est bloqué par ce
dessin.

## Comment on vérifie

| ce qu'on fait | ce qu'on doit voir |
|---|---|
| se connecter depuis claude.ai avec un email hors `ALLOWED_EMAILS` | refusé à l'écran Google, aucun jeton émis |
| appeler un outil avec un jeton révoqué | erreur MCP d'autorisation, pas un 500 |
| `submit_draft_run` avec un YAML invalide | rien n'est écrit en base, le verdict dit pourquoi |
| ouvrir l'URL de brouillon rendue | le YAML et le coût, un bouton Lancer, rien d'autre tant qu'on ne clique pas |
| `get_run_trajectory` sur une case qui n'existe pas | 404, pas de fuite du reste du run |
| `/mcp` sans jeton, depuis un navigateur anonyme | pas l'écran de connexion HTML — une erreur MCP |
| `read_prompt` depuis un client MCP | aucune mention de `/validate`, aucune forme CSV |

Deux fonctions continuent de faire autorité et se testent dans `lib/` :
`withoutIdentity`, inchangée, et `proxyMatcher`, à réétendre pour couvrir
`mcp` et `.well-known` dans le même test qui couvre déjà `shared`.
