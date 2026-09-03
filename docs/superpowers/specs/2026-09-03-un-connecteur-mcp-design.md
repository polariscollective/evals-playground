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
           →  /mcp/authorize, /mcp/token, /mcp/register, /.well-known/…
                                                        (OAuth pour s'y connecter)
```

Ça vit dans `evals-playground`, à côté de `/prompt` et `/validate` : des
machines sans cookie de session, qui s'autorisent elles-mêmes plutôt que de
compter sur le proxy.

### L'identité, un proxy devant Google

MCP demande un vrai flux OAuth pour qu'un connecteur distant se « connecte » —
pas un jeton collé à la main. On ne réinvente pas de vérification d'identité :
`/mcp/authorize` renvoie directement vers Google, avec les mêmes
`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` et le même `isAllowedEmail` qu'utilise
déjà `auth.ts`. Une fois l'email revenu et vérifié, `/mcp/token` émet un
jeton MCP propre, sans rapport avec le cookie de session NextAuth.

Deux tables neuves, dans `polaris-supabase` sous `evals/supabase/migrations/`,
en PR séparée et fusionnée d'abord — comme pour `is_public`, rien ici ne tourne
sans elles :

```sql
create table public.mcp_clients (
  id text primary key,              -- délivré à l'enregistrement dynamique
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table public.mcp_grants (
  access_token_hash text primary key,
  refresh_token_hash text not null,
  client_id text not null references public.mcp_clients(id),
  user_email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
```

Chaque appel d'outil résout son jeton en `email` via `requireMcpUser`,
parallèle à `requireUser` : un jeton inconnu ou expiré rend l'erreur MCP
attendue, un jeton valide retombe sur le même `email` que produirait une
session normale, et donc sur les mêmes fonctions de `lib/runs.ts` que le reste
de l'application — aucun code de lecture n'est dupliqué pour l'agent.

Une petite page de réglages liste les autorisations actives par email et
permet de révoquer une ligne de `mcp_grants` : couper l'accès ne doit pas
dépendre de claude.ai de l'autre côté.

Le protocole lui-même — transport HTTP de MCP, enregistrement dynamique de
client, PKCE — s'appuiera sur `@modelcontextprotocol/sdk`, qui documente ce
patron de serveur d'autorisation « proxy devant un fournisseur existant » :
c'est le seul morceau du projet qui est protocolaire plutôt que produit, et
c'est aussi le plus gros.

### Les cinq outils

| outil | rend | source |
|---|---|---|
| `read_prompt` | le contenu de `/prompt` | inchangé, juste appelable sans lien à coller |
| `submit_draft_run` | une URL de brouillon + le verdict de coût | `configProblem` / `verdictOf`, **avant** toute écriture |
| `get_run_metadata` | le run sans ses cases : label, statut, coût, modèles, notes, `is_public` | `loadRun`, sans les `samples` |
| `get_run_results` | la matrice — une ligne par scénario, la moyenne par modèle, le nombre de répétitions comptées | `lib/matrix.ts`, la même fonction que la page privée, pas les `samples` bruts |
| `get_run_trajectory` | la conversation d'**une seule case** (scénario × modèle × répétition) | une fonction neuve, ciblée, qui ne lit que cette ligne |

Aucun outil ne lance de run — confirmé, ça reste un clic humain. Aucun outil
ne liste les runs non plus : même principe que `/shared`, l'humain donne
l'identifiant à l'agent, l'application ne devient pas un répertoire.

`get_run_trajectory` mérite sa propre requête plutôt que de réutiliser
`loadRun(..., { withTranscripts: true })` et de découper après coup : un run
de taille ordinaire porte des dizaines de conversations, et les charger toutes
pour n'en rendre qu'une serait le genre de coût caché qui ne se voit qu'en
production. La fonction neuve sélectionne directement la ligne d'`eval_samples`
demandée.

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

Pas d'outil pour lancer un run depuis l'agent, pas de liste de runs, pas de
suppression d'un brouillon par l'agent lui-même, pas de rafraîchissement de
jeton géré à la main — le SDK MCP s'en charge côté client. Chacun de ces
manques est un choix, aucun n'est bloqué par ce dessin.

## Comment on vérifie

| ce qu'on fait | ce qu'on doit voir |
|---|---|
| se connecter depuis claude.ai avec un email hors `ALLOWED_EMAILS` | refusé à l'écran Google, aucun jeton émis |
| appeler un outil avec un jeton révoqué | erreur MCP d'autorisation, pas un 500 |
| `submit_draft_run` avec un YAML invalide | rien n'est écrit en base, le verdict dit pourquoi |
| ouvrir l'URL de brouillon rendue | le YAML et le coût, un bouton Lancer, rien d'autre tant qu'on ne clique pas |
| `get_run_trajectory` sur une case qui n'existe pas | 404, pas de fuite du reste du run |
| `/mcp` sans jeton, depuis un navigateur anonyme | pas l'écran de connexion HTML — une erreur MCP |

Deux fonctions continuent de faire autorité et se testent dans `lib/` :
`withoutIdentity`, inchangée, et `proxyMatcher`, à réétendre pour couvrir
`mcp` et `.well-known` dans le même test qui couvre déjà `shared`.
