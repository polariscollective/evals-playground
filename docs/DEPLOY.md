# Déployer

Trois morceaux, trois endroits. Rien de tout cela n'est automatique la première
fois ; ensuite, tout part d'un push sur `main`.

## L'application — Vercel

Le dépôt se connecte tel quel. Trois réglages qui ne se devinent pas :

| réglage | valeur | pourquoi |
|---|---|---|
| Root Directory | `web` | l'application Next.js n'est pas à la racine |
| Framework Preset | **Next.js** | à vérifier : tant que le Root Directory est la racine, Vercel voit `pyproject.toml` et propose un préréglage Python |
| Include source files outside of the Root Directory | **coché** | `shared/` est à la racine, lu par l'interface *et* par le job |

Régler le Root Directory sur `web` d'abord : la détection se refait alors sur
ce dossier, y trouve `next` dans `package.json`, et le bon préréglage se
propose tout seul.

Sans le second, le build échoue : `web/lib/shared.ts` lit `shared/pricing.json`
et les gabarits du prompt du juge par chemin relatif, hors de `web/`. Ces
fichiers sont partagés avec le Python, et les recopier dans `web/` serait
exactement ce qu'on cherche à éviter.

### Les variables d'environnement

```
SUPABASE_URL                   https://hkqzamibfpyvlowiqgpn.supabase.co
SUPABASE_SERVICE_ROLE_KEY      la clé de service du projet « evals »
BATCH_TRIGGER_URL              https://polaris-batch-trigger-…-ew.a.run.app
BATCH_TRIGGER_SECRET    le secret d'evals-playground (voir plus bas)
AUTH_GOOGLE_ID                 client OAuth Google
AUTH_GOOGLE_SECRET
AUTH_SECRET                    openssl rand -base64 32
ALLOWED_EMAILS                 adresses autorisées, séparées par des virgules
ALLOWED_DOMAINS                domaines autorisés, idem
MCP_CLIENT_ID                  openssl rand -hex 16 — voir « Le connecteur MCP »
MCP_MAX_USD_PER_RUN            borne le devis d'un run lancé par launch_draft — défaut 2
MCP_MAX_USD_PER_HOUR           borne ce qu'un même appelant MCP a lancé sur l'heure glissante — défaut 10
```

**Aucune clé de fournisseur.** Aucune route n'appelle un modèle : le devis est
du calcul, l'aperçu du prompt de la mise en forme, le reste de la lecture. Ce
qui coûte de l'argent ne vit que dans le job.

Le secret du déclencheur se relit depuis Secret Manager :

```bash
gcloud secrets versions access latest --secret=BATCH_TRIGGER_CALLERS \
  --project=polaris-dev-499211 \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['evals-playground']['secret'])"
```

### Google OAuth

L'URI de redirection à déclarer : `https://<domaine-vercel>/api/auth/callback/google`.

### Le connecteur MCP

`MCP_CLIENT_ID` n'a rien à voir avec Google : c'est une chaîne qu'on invente,
et la seule chose qui identifie claude.ai auprès de `/mcp/authorize` et
`/mcp/token`. Sans elle, ces deux routes rendent un 500 sans rien expliquer.

Côté claude.ai, une fois l'application déployée — Réglages → Connectors → Add
custom connector :

| champ | valeur |
|---|---|
| Remote MCP server URL | `https://<domaine-vercel>/mcp` |
| Authentication | *Always required* |
| OAuth client | *Use your own OAuth client* |
| Client ID | la valeur de `MCP_CLIENT_ID` |
| Client Secret | **vide** |

Le secret reste vide parce qu'il n'existe pas : le serveur n'en vérifie aucun,
c'est PKCE qui tient l'échange. Les réglages d'authentification ne se modifient
pas après coup — pour en changer un, il faut retirer le connecteur et le
rajouter.

## Le moteur — Cloud Run Job

Un push sur `main` qui touche `backend/`, `shared/`, le `Dockerfile` ou
`pyproject.toml` construit l'image et met à jour le job. Les tests passent
avant : une image poussée sur un moteur cassé serait déployée avant que
quiconque le remarque.

Le job et ses secrets sont décrits dans `polaris-tf`
(`environments/app/evals_playground_batch.tf`), pas ici.

## Le schéma — polaris-supabase

Les migrations ne sont pas dans ce dépôt. Voir le `CLAUDE.md` de l'espace de
travail pour la raison, et `polaris-supabase` pour la procédure.

## Un piège, une fois

Cloud Run refuse de créer un conteneur qui monte un secret **sans version**, et
`polaris-tf` ne gère jamais les valeurs. Un secret neuf monté par une ressource
neuve doit donc recevoir sa valeur **avant** le premier apply. C'est écrit en
tête d'`evals_playground_batch.tf`, parce que ça a coûté un apply raté.
