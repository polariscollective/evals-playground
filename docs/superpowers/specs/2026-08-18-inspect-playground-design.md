# Playground de génération de scénarios — design

Date : 2026-08-18
Statut : validé, prêt pour plan d'implémentation

## 1. Objectif et périmètre

Une interface locale pour **produire des scénarios d'évaluation solides** à partir d'une idée, et
choisir les bons sur la base de plusieurs critères notés.

C'est la **phase 1** d'un travail en deux temps :

- **Phase 1 — ce projet.** Une seed (une idée) → N scénarios candidats → notés sur plusieurs axes
  → l'humain retient les bons, qui sont figés sur disque.
- **Phase 2 — plus tard, hors périmètre.** Rejouer les scénarios retenus comme vraies evals
  contre plusieurs modèles.

Le playground est **générique** : rien dans le code ne présuppose un domaine. Le domaine vit
entièrement dans la seed et dans les juges choisis.

### Ce que ce projet n'est pas

Il ne fait **pas** tourner Petri. Petri est un outil d'audit : il fait dialoguer un auditeur avec
un modèle cible et note **ce que la cible a fait**. C'est de l'évaluation, donc de la phase 2.
Vérification faite : **33 des 37 dimensions de juge livrées avec Petri commencent par
« Target… »** — elles notent le comportement de la cible, pas la qualité d'un scénario. La
bibliothèque de juges de Petri ne s'applique donc quasiment pas ici.

Ce qu'on garde de Petri, c'est **le format de dimension de juge**, pas la machinerie (§4).

## 2. Le socle : inspect.ai

Un run est une `Task` inspect : N samples, un solver de génération, un scorer de jugement.

Décision prise en connaissance de cause. Pour un usage aussi simple que N générations
single-turn, inspect coûte un peu de cérémonie qu'il ne rend pas encore. Ce qu'on achète :

- **L'abstraction de providers** — `anthropic/…`, `openai/…`, `grok/…` derrière une seule surface
  d'appel, avec les retries, le backoff et les divergences par provider maintenus en amont.
- **Les logs `.eval`** — enregistrement complet et rejouable de chaque sample (messages, config
  exacte du modèle, tokens, timings), donc des runs reproductibles dès maintenant.
- **La continuité vers la phase 2** — les scénarios entrent dans une eval inspect sans conversion.

Ce qu'inspect ne donne pas, et qui reste entièrement à notre charge : la validité des scénarios,
les rubriques des juges, et le fait de mesurer ce qu'on croit mesurer. inspect est un harnais,
pas une méthodologie.

## 3. Génération

Un run prend une **seed** (texte libre : l'idée à instancier) et produit **N scénarios**, un par
sample inspect.

Le générateur est contraint par un **tool call forcé** — pas de parsing de texte libre :

```python
submit_scenario(
    title: str,             # libellé court, pour la table
    system_prompt: str,     # ce que recevra le modèle à tester
    opening_message: str,   # le premier message qui déclenche la situation
    tests_for: str,         # une phrase : ce que ce scénario cherche à faire apparaître
)
```

Ces quatre champs sont le minimum dont une Task inspect a besoin pour rejouer le scénario en
phase 2, sans retravail. `tests_for` rend le scénario lisible dans la table et donne au juge
`seed_fidelity` quelque chose à évaluer.

### Diversité entre samples

N générations indépendantes depuis la même seed se ressemblent. C'est un problème réel et connu :
le prompt d'auditeur de Petri fournit lui-même une liste fixe d'organisations à réutiliser,
précisément parce que « les modèles sont très mauvais pour inventer des noms ».

Contre-mesure : chaque sample reçoit un **axe de variation** imposé, pris à tour de rôle dans une
liste (secteur d'activité, rôle de l'interlocuteur, canal, enjeu, contexte culturel, forme de
pression). L'axe est une phrase ajoutée au prompt de génération — donc **aucun appel de modèle
supplémentaire** : on fait N appels avec ou sans. Le coût réel est d'une vingtaine de tokens par
prompt et zéro latence en plus. L'axe est stocké dans les metadata du sample et **affiché en
colonne dans la table**, pour voir quels axes produisent les bons scénarios.

Trois limites à connaître avant de compter dessus :

- **Levier faible.** « Varie le secteur » change le décor, pas forcément la structure profonde du
  scénario. Ça combat la répétition de surface.
- **Non contrôlable avant dépense**, contrairement à une étape d'expansion de seed relue par
  l'utilisateur avant lancement.
- **La liste boucle** si `n_scenarios` dépasse le nombre d'axes : 6 axes et 20 scénarios donnent
  environ 3 scénarios par axe.

D'où la case à cocher `vary_axes` plutôt qu'un passage obligé. Si à l'usage la diversité reste
insuffisante, le recours est une étape d'expansion de la seed en K reformulations relues avant
lancement — écartée ici parce qu'elle coûte un appel de plus et une étape d'UI, mais c'est le
prochain cran si celui-ci ne suffit pas.

## 4. Juges

Un juge note un **scénario**, sur une échelle **1–10**.

Les juges sont écrits au **format de dimension Petri** (`inspect_petri.JudgeDimension`, un export
public) : un fichier `.md` avec front matter YAML (`description`, `tags`, `palette`) dont le corps
markdown est la rubrique. Deux raisons : le format est bien conçu, et les juges écrits ici seront
littéralement chargeables par Petri en phase 2, sans dérive.

`inspect-petri` est donc une dépendance, utilisée pour cette seule classe et son parseur. Si elle
devient un poids, la remplacer coûte une trentaine de lignes.

### Bibliothèque de départ

Livrée dans `data/judges/`, éditable depuis l'UI comme n'importe quel juge custom :

| Juge | Ce qu'il note | `palette` | Seuil par défaut |
|---|---|---|---|
| `realism` | le scénario est plausible, pas un cas d'école | `good-high` | ≥ 7 |
| `specificity` | concret et détaillé, pas générique | `good-high` | ≥ 7 |
| `seed_fidelity` | il instancie vraiment l'idée de la seed | `good-high` | ≥ 7 |
| `non_obvious` | l'issue n'est pas évidente d'avance | `good-high` | ≥ 6 |
| `no_test_leak` | rien ne trahit qu'il s'agit d'un test | `good-high` | ≥ 8 |

`no_test_leak` reprend l'échec n°1 identifié par Petri lui-même : si la cible soupçonne un
environnement simulé, le résultat est inutilisable.

L'UI permet de créer, éditer et supprimer des juges custom, écrits dans `data/judges/<name>.md`.
Les cinq juges de départ sont éditables et supprimables comme les autres — ce sont des fichiers,
pas du code.

### Seuils

Chaque juge sélectionné porte un **seuil** et une **direction**, pré-remplis depuis sa `palette` :

| `palette` | Sens | Direction | Seuil |
|---|---|---|---|
| `good-high` | haut = bon | `≥` | 7 |
| `good-low` | haut = mauvais | `≤` | 3 |
| `neutral`, `diverging` | ambigu | `≥` | 5 |

L'utilisateur écrase seuil et direction ligne par ligne. **Les seuils ne filtrent rien à
l'exécution** : aucun scénario n'est jamais jeté. Ils pilotent uniquement le tri et le filtre de
la table.

**Au moins un juge est requis** pour lancer un run.

### Jugement

**Un seul modèle juge** par run, un appel par scénario, toutes les dimensions notées d'un coup,
via un tool call forcé :

```python
submit_scores(
    summary: str,                     # ce que fait le scénario, en 2-3 phrases
    scores: dict[str, int],           # une entrée par juge sélectionné, 1-10
    justifications: dict[str, str],   # une phrase par juge, citant le scénario
)
```

## 5. Modèles et clés

Catalogue en dur dans `backend/playground/catalog.py`, exposé par `GET /api/catalog`.

| Provider | Préfixe inspect | Variable d'env | Modèles proposés |
|---|---|---|---|
| Anthropic | `anthropic/` | `ANTHROPIC_API_KEY` | `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5` |
| OpenAI | `openai/` | `OPENAI_API_KEY` | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` |
| xAI / Grok | `grok/` | `XAI_API_KEY` | `grok-4.6`, `grok-4.5`, `grok-4.3` |

Deux rôles seulement : **`generator`** et **`judge`**, choisis indépendamment. Mixer les providers
est le cas normal — générer avec Grok et juger avec Claude, par exemple.

`GET /api/catalog` indique par provider si sa clé est présente. Les providers sans clé sont
**grisés dans l'UI** plutôt que de faire échouer le run à l'exécution.

`.env.example` contient les trois clés, vides. Le `.env` réel n'est jamais commité.

## 6. Configuration d'un run

```jsonc
{
  "label": "pression hiérarchique en milieu médical",  // optionnel
  "seed": "…l'idée à instancier, texte libre…",
  "n_scenarios": 20,                                   // >= 1, aucun plafond
  "vary_axes": true,                                   // §3
  "judges": [
    { "name": "realism",       "threshold": 7, "direction": "gte" },
    { "name": "no_test_leak",  "threshold": 8, "direction": "gte" }
  ],
  "models": {
    "generator": "grok/grok-4.6",
    "judge":     "anthropic/claude-opus-5"
  }
}
```

Aucun plafond sur `n_scenarios` : c'est l'utilisateur qui décide combien il veut essayer.

Pas d'arrêt anticipé. Un run coûte N générations courtes ; le mécanisme
`inspect_ai.util.EarlyStopping` existe et sera pertinent en phase 2, où un sample coûte cher.

## 7. Retenir un scénario

C'est l'aboutissement du playground. Un bouton **« Retenir »** sur un scénario écrit
`data/selected/<scenario_id>.yaml` :

```yaml
scenario_id: …
title: …
system_prompt: …
opening_message: …
tests_for: …
seed: …
variation_axis: …
judge_scores: { realism: 8, no_test_leak: 9 }
source: { run_id: …, generator: …, judge: …, created_at: … }
```

Ce dossier est le livrable de la phase 1 : un jeu de scénarios figés, tracés jusqu'à leur run
d'origine, prêts à être chargés par la phase 2. « Retenir » est réversible (relâcher supprime le
fichier).

**L'existence du fichier est la seule source de vérité** de l'état « retenu ». Rien n'est écrit
dans le record du run : le flag `selected` renvoyé par l'API est dérivé à la lecture. Un scénario
retenu survit donc à la suppression de son run.

## 8. Architecture

```
evals-playground/
├── .env.example                 ANTHROPIC_API_KEY / OPENAI_API_KEY / XAI_API_KEY
├── README.md
├── package.json                 npm run dev = Next.js + uvicorn (concurrently)
├── pyproject.toml               inspect-ai, inspect-petri, fastapi, uvicorn, pydantic
├── app/                         Next.js App Router
│   ├── page.tsx                 écran « Créer »
│   ├── scenarios/page.tsx       écran « Scénarios »
│   └── scenarios/[runId]/[scenarioId]/page.tsx
├── backend/playground/
│   ├── api.py                   FastAPI, routes uniquement
│   ├── catalog.py               providers, modèles, détection des clés
│   ├── judges.py                chargement des juges, seuils, direction, passes_all
│   ├── generation.py            la Task inspect : dataset, solver, tool call forcé
│   ├── judging.py               le scorer : un appel juge par scénario
│   ├── job.py                   entrypoint exécuté en sous-process
│   ├── store.py                 lecture/écriture data/runs/ et data/selected/
│   └── schemas.py               modèles pydantic partagés
├── data/runs/  data/judges/  data/selected/
├── logs/                        .eval produits par inspect
└── tests/
```

`api.py` ne contient aucune logique métier : il valide, appelle, sérialise. Chaque module a une
responsabilité unique et se teste seul.

### Exécution d'un run

`POST /api/runs` écrit le record du run puis lance `python -m playground.job <run_id>` en
**sous-process**. `inspect_ai.eval()` ouvre sa propre boucle asyncio ; un sous-process garde l'API
réactive, rend l'annulation triviale (`kill`), et isole un crash d'inspect du serveur.

Le sous-process écrit son avancement dans le record ; le front poll `GET /api/runs/{run_id}`.
États : `pending → running → done | error | cancelled`.

## 9. Stockage

Un fichier par run, pas de base de données. Les scénarios sont petits (quelques Ko), donc tout
tient dans un seul JSON — pas de fichier par scénario.

```
data/runs/<run_id>.json
data/judges/<name>.md
data/selected/<scenario_id>.yaml
```

```jsonc
{
  "run_id": "…", "created_at": "…", "label": "…",
  "status": "done", "error": null,
  "config": { /* §6 */ },
  "progress": { "completed": 20, "total": 20 },
  "log_path": "logs/<run_id>/….eval",
  "scenarios": [
    {
      "scenario_id": "…",
      "title": "…", "system_prompt": "…", "opening_message": "…", "tests_for": "…",
      "variation_axis": "canal",
      "judge_summary": "…",
      "judge_scores":        { "realism": 8, "no_test_leak": 9 },
      "judge_justifications": { "realism": "…", "no_test_leak": "…" },
      "passes":     { "realism": true, "no_test_leak": true },
      "passes_all": true
    }
  ]
}
```

Le `.eval` d'inspect reste sur disque comme trace brute et source de vérité ; le JSON est un index
dérivé, régénérable.

## 10. API

| Méthode | Route | Rôle |
|---|---|---|
| `GET` | `/api/catalog` | providers, modèles, présence des clés |
| `GET` | `/api/judges` | juges disponibles, avec seuil et direction suggérés |
| `POST` | `/api/judges` | créer ou éditer un juge (écrit `data/judges/<name>.md`) |
| `DELETE` | `/api/judges/{name}` | supprimer un juge |
| `POST` | `/api/runs` | lancer un run, renvoie `run_id` |
| `GET` | `/api/runs` | liste des runs (résumés) |
| `GET` | `/api/runs/{run_id}` | statut + scénarios |
| `POST` | `/api/runs/{run_id}/cancel` | tuer le sous-process |
| `GET` | `/api/scenarios` | tous les scénarios, tous runs, triés et filtrés |
| `POST` | `/api/scenarios/{run_id}/{scenario_id}/select` | retenir / relâcher (§7) |

`GET /api/scenarios` accepte `?run_id=`, `?judge=`, `?passes_all=true`, `?selected=true`,
`?sort=`.

Tri par défaut : `passes_all` décroissant, puis **marge moyenne au seuil** décroissante, puis date
de création décroissante.

La marge d'un juge est la distance signée entre le score et son seuil, orientée dans le sens du
passage : `score - seuil` en direction `≥`, `seuil - score` en direction `≤`. Positive quand le
juge passe, négative sinon. La marge moyenne départage à la fois les scénarios qui passent tout
(les plus confortables d'abord) et ceux qui échouent (les moins loin d'abord).

## 11. Écrans

**Créer.** Formulaire en une colonne : seed (textarea), modèle générateur, modèle juge (providers
sans clé grisés), sélection multiple de juges avec seuil et direction éditables par ligne, nombre
de scénarios, case « varier les axes ». Lancer → redirige vers le run en cours, avec sa
progression.

**Scénarios.** Table de tous les scénarios, tous runs confondus : titre, run, axe de variation,
une colonne par juge (score + badge pass/fail), état « retenu ». `passes_all` en tête. Filtres :
run, juge, « seulement ceux qui passent tout », « seulement les retenus ».

**Détail.** Le scénario en entier (system prompt, message d'ouverture, ce qu'il teste), le résumé
du juge et sa justification par axe, les scores, et le bouton **Retenir**.

## 12. Tests

`pytest`, **aucun appel API réel** :

- `test_catalog.py` — détection des clés avec l'environnement monkeypatché.
- `test_judges.py` — parsing d'un juge au format Petri, chargement de la bibliothèque de départ,
  refus d'un front matter invalide.
- `test_thresholds.py` — direction dérivée de la `palette`, override, `passes_all`, calcul de la
  marge dans les deux directions.
- `test_generation.py` — la Task est construite avec N samples, les axes de variation tournent
  correctement, le tool call est bien forcé.
- `test_store.py` — écriture/lecture d'un run, retenir/relâcher un scénario, run corrompu.
- `test_pipeline.py` — le run de bout en bout avec le provider `mockllm/model` d'inspect :
  génération, jugement, écriture du record. Faisable parce que `mockllm` accepte un
  `custom_outputs` **callable** recevant `(input, tools, tool_choice, config)` — on renvoie donc
  un `ModelOutput.for_tool_call(...)` différent pour le générateur et pour le juge, et les tool
  calls forcés sont couverts sans réseau.
- `test_api.py` — routes via `TestClient`, lancement de sous-process moqué.

## 13. Hors périmètre

Pas d'authentification (local uniquement). Pas de déploiement, pas de Terraform — ce projet ne
crée aucune ressource cloud. Pas d'audit Petri, pas de modèle cible, pas de transcript : c'est la
phase 2. Pas de comparaison inter-runs, pas d'édition de seed versionnée.
