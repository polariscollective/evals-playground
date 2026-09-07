# Un catalogue large, et des favoris qui le rendent habitable

*7 septembre 2026*

## Le problème

Le catalogue tient en neuf modèles écrits à la main dans `shared/pricing.json`.
C'était tenable tant qu'il décrivait ce qu'on voulait proposer ; ça ne l'est
plus dès qu'on veut pouvoir comparer une génération à la précédente, ou tester
un modèle qu'on n'avait pas prévu. Quarante et un modèles méritent d'y entrer.

Mais un menu déroulant de quarante et une entrées est pire que neuf. Et le
prompt de l'agent, qui publie la liste entière à chaque appel, deviendrait
long sans rien gagner.

D'où les deux moitiés de ce chantier, qui ne valent qu'ensemble : **le
catalogue s'ouvre en grand, et chacun choisit ce qu'il en voit.**

## Le catalogue

Une règle d'entrée, écrite dans le fichier :

> un modèle de texte, qui accepte des outils, dont le tarif est publié, et qui
> a réellement répondu à un appel passé par `inspect_ai`.

La dernière clause n'est pas décorative : les quarante et un modèles ci-dessous
ont chacun reçu un appel avec un système, un message, une définition d'outil et
une température, par le même chemin que le job. Ce qui n'a pas répondu n'est pas
là.

### Anthropic — `anthropic/`, clé `ANTHROPIC_API_KEY`

| identifiant | libellé | in $/Mtok | out $/Mtok | température |
|---|---|---|---|---|
| `claude-fable-5-1` | Claude Fable 5.1 | 10 | 50 | ignorée |
| `claude-fable-5` | Claude Fable 5 | 10 | 50 | ignorée |
| `claude-opus-5` | Claude Opus 5 | 5 | 25 | ignorée |
| `claude-opus-4-8` | Claude Opus 4.8 | 5 | 25 | ignorée |
| `claude-opus-4-7` | Claude Opus 4.7 | 5 | 25 | ignorée |
| `claude-opus-4-6` | Claude Opus 4.6 | 5 | 25 | honorée |
| `claude-opus-4-5` | Claude Opus 4.5 | 5 | 25 | honorée |
| `claude-sonnet-5` | Claude Sonnet 5 | 2 | 10 | ignorée |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 3 | 15 | honorée |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 | 3 | 15 | honorée |
| `claude-haiku-4-5` | Claude Haiku 4.5 | 1 | 5 | honorée |

### OpenAI — `openai/`, clé `OPENAI_API_KEY`

| identifiant | libellé | in $/Mtok | out $/Mtok | température |
|---|---|---|---|---|
| `gpt-6-astra` | GPT-6 Astra | 10 | 50 | ignorée |
| `gpt-5.6-sol` | GPT-5.6 Sol | 4 | 20 | honorée |
| `gpt-5.6-terra` | GPT-5.6 Terra | 2 | 12 | honorée |
| `gpt-5.6-luna` | GPT-5.6 Luna | 0.20 | 1.20 | honorée |
| `gpt-5.5` | GPT-5.5 | 5 | 30 | honorée |
| `gpt-5.4` | GPT-5.4 | 2.50 | 15 | honorée |
| `gpt-5.4-mini` | GPT-5.4 mini | 0.75 | 4.50 | honorée |
| `gpt-5.4-nano` | GPT-5.4 nano | 0.20 | 1.25 | honorée |
| `gpt-5.2` | GPT-5.2 | 1.75 | 14 | honorée |
| `gpt-5.1` | GPT-5.1 | 1.25 | 10 | honorée |
| `gpt-5` | GPT-5 | 1.25 | 10 | honorée |
| `gpt-5-mini` | GPT-5 mini | 0.25 | 2 | honorée |
| `gpt-5-nano` | GPT-5 nano | 0.05 | 0.40 | honorée |
| `gpt-4.1` | GPT-4.1 | 2 | 8 | honorée |
| `gpt-4.1-mini` | GPT-4.1 mini | 0.40 | 1.60 | honorée |
| `gpt-4.1-nano` | GPT-4.1 nano | 0.10 | 0.40 | honorée |
| `gpt-4o` | GPT-4o | 2.50 | 10 | honorée |
| `gpt-4o-mini` | GPT-4o mini | 0.15 | 0.60 | honorée |

### xAI — `grok/`, clé `XAI_API_KEY` ou `GROK_API_KEY`

| identifiant | libellé | in $/Mtok | out $/Mtok | température |
|---|---|---|---|---|
| `grok-4.6` | Grok 4.6 | 2 | 6 | honorée |
| `grok-4.5` | Grok 4.5 | 2 | 6 | honorée |
| `grok-4.3` | Grok 4.3 | 1.25 | 2.50 | honorée |
| `grok-4.20-0309-reasoning` | Grok 4.20 (reasoning) | 1.25 | 2.50 | honorée |
| `grok-4.20-0309-non-reasoning` | Grok 4.20 (non-reasoning) | 1.25 | 2.50 | honorée |

Les tarifs xAI doublent au-delà de 200 000 jetons d'entrée. Le devis les traite
à plat, délibérément — l'arbitrage et son prix sont déjà écrits en tête de
`web/lib/pricing.ts`, et les trois nouveaux modèles n'y changent rien.

### Google — `google/`, clé `GEMINI_API_KEY` ou `GOOGLE_API_KEY`

| identifiant | libellé | in $/Mtok | out $/Mtok | température |
|---|---|---|---|---|
| `gemini-3.8-flash` | Gemini 3.8 Flash | 0.75 | 3.75 | honorée |
| `gemini-3.7-flash` | Gemini 3.7 Flash | 0.75 | 3.75 | honorée |
| `gemini-3.6-flash` | Gemini 3.6 Flash | 0.75 | 3.75 | honorée |
| `gemini-3.5-flash` | Gemini 3.5 Flash | 1.50 | 9 | honorée |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | 0.30 | 2.50 | honorée |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (preview) | 2 | 12 | honorée |
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash-Lite | 0.25 | 1.50 | honorée |

### Ce qui est resté dehors, et pourquoi

| écarté | raison |
|---|---|
| `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` | 404 : « no longer available to new users » |
| `gemini-3-flash-preview` | répond, mais aucun tarif publié — et les Flash 3.6/3.7/3.8 le remplacent |
| `claude-mythos-5`, `claude-mythos-5-1` | `not_found_error` : *limited availability* (glasswing) |
| `gpt-5-pro`, `gpt-5.2-pro`, `gpt-5.4-pro`, `gpt-5.5-pro` | 30 $/180 $ par million ; une matrice avec ça dedans coûte un salaire |
| `grok-4.20-multi-agent-0309` | un orchestrateur, pas un modèle |
| `*-codex*`, `*-chat-latest`, `*-search-preview` | surface d'API ou réglage différents du reste |
| gemma, lyria, nano-banana, `*-tts`, `*-transcribe`, `*-image`, robotics, computer-use, deep-research | pas des modèles de texte outillés |
| GPT-4 et antérieurs, GPT-3.5, `babbage`, `davinci` | retirés ou sans outils |

### Deux tarifs corrigés au passage

`shared/pricing.json` porte deux prix qui ne sont plus les bons. Ils ne sont pas
« mis à jour » discrètement : ce sont des corrections, et le devis affiché
change avec elles.

| modèle | écrit dans le dépôt | tarif officiel |
|---|---|---|
| `openai/gpt-5.6-sol` | 5 / 30 | **4 / 20** |
| `anthropic/claude-sonnet-5` | 3 / 15 | **2 / 10** |

## La température qui ne fait rien

Sept modèles acceptent l'appel et jettent la température : Claude 4.7 et
au-delà tournent en *adaptive thinking* et refusent le paramètre, `inspect_ai`
le retire et journalise un avertissement que personne ne lit. `gpt-6-astra`
fait pareil.

Ça n'est pas un bug qu'on introduit — `claude-opus-5` est déjà dans les
favoris d'aujourd'hui, et le curseur de température de la page de run ne
mesure déjà rien sur lui. Mais passer de neuf à quarante et un modèles fait
passer le piège de « un modèle sur neuf » à « sept sur quarante et un », et
quelqu'un finira par lancer une matrice de température qui ne mesure que du
bruit.

Le traitement est minuscule et tient en deux morceaux :

- un champ `honours_temperature` dans le catalogue, absent valant `true` ;
- sur la page de run, quand un modèle évalué sélectionné l'ignore, une ligne
  sous le réglage de température qui le nomme.

Rien d'autre. On ne grise pas le réglage, on ne refuse pas le run : un run à
température fixe sur ces modèles est parfaitement légitime, c'est le *balayage*
qui ne mesure rien.

## Les favoris

### Où ils vivent

Une migration dans `polaris-supabase`, sous `evals/supabase/migrations/` :

```sql
alter table profiles add column favorite_models text[];
```

`NULL` veut dire « utilise le défaut du code ». C'est exactement la convention
de `scenario_advice` sur cette même table, et pour la même raison, qui sera
répétée dans la migration : recopier le défaut dans chaque ligne priverait
silencieusement toute personne n'ayant jamais touché à sa liste des modèles
qu'on ajoutera plus tard. Le défaut vit dans le code ; seule la surcharge vit
en base.

Le défaut du code, ce sont les neuf modèles d'aujourd'hui plus Fable 5.1 :

```
anthropic/claude-fable-5-1   anthropic/claude-opus-5   anthropic/claude-sonnet-5
anthropic/claude-haiku-4-5   openai/gpt-5.6-sol        openai/gpt-5.6-terra
openai/gpt-5.6-luna          grok/grok-4.6             grok/grok-4.5
grok/grok-4.3
```

Deux refus à l'écriture : un tableau vide (sans un seul favori, l'application
n'a plus rien à proposer nulle part) et un identifiant hors catalogue.

### Deux ensembles, jamais confondus

C'est le cœur du design, et ce qui évite de casser l'existant.

| fonction | répond à | s'en servent |
|---|---|---|
| `knownModelIds()` | « cet identifiant existe-t-il ? » | `configProblem`, l'affichage des runs passés |
| `favoriteModels(profile)` | « qu'est-ce qu'on propose ? » | les écrans, le prompt, les outils MCP |

`configProblem` **continue de valider contre le catalogue entier**. Le refus
des non-favoris est une seconde vérification, ajoutée **dans les outils MCP
seulement**.

Conséquences, toutes voulues :

- un run déjà lancé s'affiche avec ses modèles quoi qu'il advienne des favoris ;
- une relance pré-remplie reste lançable à la main, le modèle hors favoris
  affiché comme tel ;
- un humain garde la main ; c'est l'agent qu'on borne.

Le message de refus MCP distingue les deux cas plutôt que de dire « inconnu » :

> `openai/gpt-5.4` exists, but it is not in your favourite models — it may have
> been before. Add it back in your profile to use it.

### Où les favoris se voient

| endroit | aujourd'hui | après |
|---|---|---|
| page de run — modèles évalués, adversaire, juge | catalogue entier | favoris, + une ligne « Only your favourite models are listed » et un lien vers `/profile` |
| `ExtendPanel` | catalogue entier | favoris |
| « Add a judge » sur un run | seulement les modèles **du run** | favoris ∪ modèles du run |
| `read_prompt` (MCP) | catalogue entier | les favoris de l'appelant |
| `/prompt` (HTTP) | catalogue entier | **le défaut du code** |

La dernière ligne mérite sa raison : `/prompt` est dans `OPEN_PREFIXES`, donc
sans session, donc sans profil. Elle sert le défaut, exactement comme
`/scenario-advice` sert déjà le conseil par défaut et pour le motif que son
commentaire donne — « sans session, on ne sait pas qui demande, donc rien qui
dépende de qui demande ne peut sortir ici ».

### L'écran de profil

Une section en bas de `/profile`, sous les plafonds : les favoris épinglés en
haut derrière un filet, puis le reste groupé par fournisseur ; une case et le
tarif par ligne ; un bouton Save comme les plafonds. Les modèles qui ignorent
la température le disent ici aussi.

## Ce que le moteur exige en plus

Ajouter Google n'est pas qu'une ligne de données.

| changement | pourquoi |
|---|---|
| `google-genai>=1.0` dans `pyproject.toml` | le provider `google/` d'inspect exige son SDK — le fichier le dit déjà : « sans quoi le modèle échoue silencieusement au premier appel » |
| `inspect-ai>=0.3.263` (au lieu de `>=0.3.249`) | en 0.3.259, `gpt-6-astra` part en Chat Completions avec `max_tokens` et se fait refuser ; 0.3.263 le reconnaît |
| `anthropic>=1.0` (au lieu de `>=0.40`) | exigé par inspect-ai 0.3.263 |

Les 392 tests Python passent sur ces trois versions.

## Terraform

Aucun secret Gemini n'existe, ni dans `polaris-dev` ni dans `polaris-prod`
(vérifié avec `admin@polariscollective.org` ; les `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` de `secrets.tf` sont l'OAuth de connexion, sans rapport).

Il faut donc, dans `polaris-tf` :

1. un secret `GEMINI_API_KEY` dans `environments/app/secrets.tf`, sur le patron
   d'`OPENAI_API_KEY` — conteneur seulement, jamais de valeur ;
2. son montage dans `environments/app/evals_playground_batch.tf`, à côté des
   trois autres.

**La valeur doit être posée avant le premier apply.** Cloud Run refuse de créer
un conteneur qui monte un secret sans version, et le README de `polaris-tf` note
que ça a déjà coûté un apply raté.

Ce dépôt-ci ne fait qu'ajouter `GEMINI_API_KEY` à `.env.example` et à la liste
de `docs/DEPLOY.md`. Les changements Terraform partent en PR séparée, sur
`polaris-tf`, et ne sont pas appliqués depuis ici.

## Ce qu'on ne fait pas

- **Aucun bouton de test** dans le produit. Ç'aurait voulu dire soit des clés de
  fournisseur sur Vercel — que `docs/DEPLOY.md` interdit explicitement — soit un
  aller-retour par le Cloud Run Job pour répondre « oui ». Les mini-tests ont eu
  lieu une fois, ici, et leur résultat est le tableau du catalogue ci-dessus.
- **Aucun changement au moteur Python** hors dépendances : `catalog.py` et
  `pricing.py` lisent déjà `shared/pricing.json`, et `known_model_ids()` reste
  le catalogue entier — le job exécute ce que le run dit, pas ce que les favoris
  d'aujourd'hui disent.
- **Aucun filtrage à l'affichage d'un run passé.**

## Comment on saura que ça marche

- `favoriteModels` : `NULL` rend le défaut, une liste rend la liste, le tableau
  vide est refusé, un identifiant hors catalogue est refusé.
- Le refus MCP dit « pas dans tes favoris » pour un modèle du catalogue, et
  « n'existe pas » pour le reste.
- `configProblem` accepte toujours un modèle du catalogue hors favoris — c'est
  ce qui garde la relance humaine possible.
- Chaque modèle du catalogue a un tarif ; aucun identifiant de `providers` ne
  manque à `prices`. Un test le tient, des deux côtés.
- `/prompt` sans session rend le défaut ; `read_prompt` avec session rend les
  favoris de l'appelant.
