# Catalogue large et favoris par profil — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ouvrir le catalogue à 41 modèles sur quatre fournisseurs, et donner à chaque personne une liste de favoris qui décide seule de ce que les écrans, le prompt et les outils MCP lui montrent.

**Architecture:** `shared/pricing.json` reste la source unique lue par Python et TypeScript ; il grossit et gagne un champ `honours_temperature`. Les favoris vivent dans une colonne `text[]` de `profiles`, `NULL` valant « le défaut du code ». Deux fonctions ne se confondent jamais : `knownModelIds()` (le catalogue entier, qui valide et affiche l'existant) et `favoriteModels(profile)` (ce qu'on propose). Le refus des non-favoris n'existe que dans les outils MCP.

**Tech Stack:** Next.js 16 (App Router) + TypeScript côté web, Python 3.12 + `inspect_ai` côté moteur, Supabase (PostgREST) pour le stockage, `node:test` et `pytest` pour les tests.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-09-07-catalogue-et-favoris-design.md`. En cas de contradiction, le spec fait foi.
- Les migrations SQL ne vivent **pas** dans ce dépôt. Elles vont dans `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/`, et se commitent là-bas.
- Les changements Terraform vont dans `/Users/sverbo/Desktop/Codes/Polaris/polaris-tf/`, se commitent là-bas, et **ne sont jamais appliqués** depuis ce chantier.
- Planchers de dépendances Python, valeurs exactes : `inspect-ai>=0.3.263`, `anthropic>=1.0`, `google-genai>=1.0`.
- Le fournisseur Google porte l'identifiant `google`, le préfixe de modèle `google/`, et les variables d'environnement `["GEMINI_API_KEY", "GOOGLE_API_KEY"]` dans cet ordre.
- Défaut de favoris, dix identifiants exactement : `anthropic/claude-fable-5-1`, `anthropic/claude-opus-5`, `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5`, `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-luna`, `grok/grok-4.6`, `grok/grok-4.5`, `grok/grok-4.3`.
- Les sept modèles qui ignorent la température : `anthropic/claude-fable-5-1`, `anthropic/claude-fable-5`, `anthropic/claude-opus-5`, `anthropic/claude-opus-4-8`, `anthropic/claude-opus-4-7`, `anthropic/claude-sonnet-5`, `openai/gpt-6-astra`.
- Tests, et l'état de départ mesuré dans ce worktree :

  | commande | où | départ |
  |---|---|---|
  | `.venv/bin/python -m pytest -q` | racine | `392 passed` |
  | `npm test` | `web/` | `511 pass, 0 fail` |
  | `npx tsc --noEmit` | `web/` | propre |
  | `npx eslint app lib components` | `web/` | propre |

- **`npm run lint` sans argument ne sert à rien ici** : il balaie
  `web/public/inspect-view`, un bundle vendu et généré, et rend 251 erreurs et
  5810 avertissements qui existent déjà sur `main`. Cadrer sur les sources —
  `npx eslint app lib components` — est la seule lecture qui distingue une
  faute à soi d'un bruit hérité.
- **`npx tsc --noEmit` a besoin d'un `npx next typegen` une fois** dans un
  worktree neuf, sans quoi il rend `Cannot find name 'LayoutProps'` : ce type
  est généré par Next et absent tant que rien n'a été construit. Ce n'est pas
  une faute du code.
- Les commentaires du code de ce dépôt sont en français et disent *pourquoi*, pas *quoi*. Les textes vus par un humain ou un agent sont en anglais.

---

## Structure des fichiers

**Créés**

| fichier | responsabilité |
|---|---|
| `web/lib/favorite-models.ts` | la résolution des favoris et ses refus, sans Supabase ni session |
| `web/lib/favorite-models.test.mts` | ses tests |
| `web/lib/catalog.test.mts` | l'intégrité du catalogue : tout modèle proposé a un tarif |
| `polaris-supabase/evals/supabase/migrations/20260907120000_profiles_favorite_models.sql` | la colonne |
| `polaris-tf/environments/app/` (modif) | le secret `GEMINI_API_KEY` et son montage |

**Modifiés** — `shared/pricing.json`, `pyproject.toml`, `backend/playground/catalog.py`, `tests/test_catalog.py`, `web/lib/types.ts`, `web/lib/catalog.ts`, `web/lib/profiles.ts`, `web/lib/profile-caps.ts`, `web/lib/api.ts`, `web/lib/agent-prompt.ts`, `web/app/api/profile/route.ts`, `web/app/api/catalog/route.ts`, `web/app/prompt/route.ts`, `web/app/mcp/route.ts`, `web/app/profile/page.tsx`, `web/app/page.tsx`, `web/components/ExtendPanel.tsx`, `web/app/eval/[runId]/page.tsx`, `.env.example`, `docs/DEPLOY.md`.

---

### Task 1 : Les dépendances du moteur

Sans elles, Google échoue silencieusement au premier appel et `gpt-6-astra` se fait refuser par OpenAI. Rien d'autre dans ce chantier ne marche tant que celle-ci n'est pas passée.

**Files:**
- Modify: `pyproject.toml:6-22`

**Interfaces:**
- Consumes: rien.
- Produces: un environnement Python où `google/…` et `openai/gpt-6-astra` répondent.

- [ ] **Step 1: Relever les trois planchers**

Dans `pyproject.toml`, remplacer le bloc `dependencies` par :

```toml
dependencies = [
    # 0.3.263 et pas moins : en 0.3.259, `gpt-6-astra` part en Chat Completions
    # avec `max_tokens` et OpenAI le refuse (« use max_completion_tokens »).
    "inspect-ai>=0.3.263",
    "inspect-petri>=3.0.11",
    # Providers d'inspect : chacun exige son SDK, sans quoi le modèle
    # échoue silencieusement au premier appel — une colonne vide dans la
    # matrice, sans message d'erreur.
    # `anthropic` en 1.x est exigé par inspect-ai 0.3.263, qui refuse en
    # dessous : « Anthropic API requires at least version 1.0.0 ».
    "anthropic>=1.0",
    "openai>=1.0",
    "xai-sdk>=0.1",
    "google-genai>=1.0",
    "pydantic>=2.7",
    # Le client HTTP du magasin Supabase. Le SDK `supabase-py` traînerait son
    # propre client, sa gestion d'authentification et son moteur de requêtes
    # pour la poignée d'opérations que fait le job.
    "httpx>=0.27",
    "pyyaml>=6.0",
    "python-dotenv>=1.0",
]
```

- [ ] **Step 2: Installer et vérifier les versions**

```bash
.venv/bin/pip install -q --upgrade "inspect-ai>=0.3.263" "anthropic>=1.0" "google-genai>=1.0"
.venv/bin/python -c "import importlib.metadata as md; print(md.version('inspect-ai'), md.version('anthropic'), md.version('google-genai'))"
```

Attendu : trois versions, la première `0.3.263` ou plus, la deuxième `1.` ou plus.

- [ ] **Step 3: Vérifier que rien n'a cassé**

```bash
.venv/bin/python -m pytest -q
```

Attendu : `392 passed`.

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml
git commit -m "chore: le SDK Google, et les planchers qu'inspect 0.3.263 exige"
```

---

### Task 2 : Le catalogue, en données

Le cœur du chantier. Le fichier partagé passe de neuf à quarante et un modèles, gagne un fournisseur et un champ, et corrige deux tarifs faux.

**Files:**
- Modify: `shared/pricing.json` (remplacement complet)
- Modify: `backend/playground/catalog.py:16-36` (le champ sur `ModelOption`)
- Modify: `tests/test_catalog.py` (attentes à jour + intégrité)
- Create: `web/lib/catalog.test.mts`
- Modify: `web/lib/types.ts:874-881` (`ModelOption`)
- Modify: `web/lib/catalog.ts:35-58` (`catalog()`)

**Interfaces:**
- Consumes: rien.
- Produces :
  - `shared/pricing.json` → `prices: Record<string, {input_per_mtok: number, output_per_mtok: number}>` (41 clés) et `providers: {id, label, env_vars: string[], models: {id, label, honours_temperature?: false}[]}[]` (4 entrées).
  - TS `ModelOption` gagne `honours_temperature: boolean` (jamais optionnel une fois sorti de `catalog()`).
  - Python `ModelOption` gagne `honours_temperature: bool = True`.
  - `knownModelIds(): Set<string>` — inchangée de signature, 41 entrées.

- [ ] **Step 1: Écrire le test d'intégrité TypeScript, qui doit échouer**

Créer `web/lib/catalog.test.mts` :

```typescript
// Le catalogue tient-il debout ? Un modèle proposé sans tarif serait compté
// pour zéro par le devis — un run annoncé gratuit et facturé plein.
import { test } from "node:test";
import assert from "node:assert/strict";
import { catalog, knownModelIds } from "./catalog.ts";
import { SHARED_PRICING } from "./shared.ts";

const NO_FAVOURITES: string[] = [];

test("chaque modèle proposé a un tarif", () => {
  const priced = new Set(Object.keys(SHARED_PRICING.prices));
  const unpriced = [...knownModelIds()].filter((id) => !priced.has(id));
  assert.deepEqual(unpriced, []);
});

test("aucun tarif ne traîne sans modèle qui le porte", () => {
  // L'inverse compte autant : un tarif orphelin est le reste d'un modèle
  // retiré, et il fera croire à une couverture qui n'existe plus.
  const known = knownModelIds();
  const orphans = Object.keys(SHARED_PRICING.prices).filter((id) => !known.has(id));
  assert.deepEqual(orphans, []);
});

test("les quatre fournisseurs sont là, dans l'ordre", () => {
  assert.deepEqual(
    catalog(NO_FAVOURITES).map((p) => p.id),
    ["anthropic", "openai", "grok", "google"],
  );
});

test("le catalogue porte quarante et un modèles", () => {
  assert.equal(knownModelIds().size, 41);
});

test("les sept modèles qui jettent la température sont marqués", () => {
  // Marqués et non retirés : un run à température fixe sur eux est
  // légitime, c'est le balayage qui ne mesurerait rien.
  const ignoring = catalog(NO_FAVOURITES)
    .flatMap((p) => p.models)
    .filter((m) => !m.honours_temperature)
    .map((m) => m.id)
    .sort();
  assert.deepEqual(ignoring, [
    "anthropic/claude-fable-5",
    "anthropic/claude-fable-5-1",
    "anthropic/claude-opus-4-7",
    "anthropic/claude-opus-4-8",
    "anthropic/claude-opus-5",
    "anthropic/claude-sonnet-5",
    "openai/gpt-6-astra",
  ]);
});

test("un modèle sans marque honore la température", () => {
  const haiku = catalog(NO_FAVOURITES)
    .flatMap((p) => p.models)
    .find((m) => m.id === "anthropic/claude-haiku-4-5");
  assert.equal(haiku?.honours_temperature, true);
});

test("les favoris passés sont marqués, et eux seuls", () => {
  const marked = catalog(["anthropic/claude-opus-5", "grok/grok-4.6"])
    .flatMap((p) => p.models)
    .filter((m) => m.favorite)
    .map((m) => m.id)
    .sort();
  assert.deepEqual(marked, ["anthropic/claude-opus-5", "grok/grok-4.6"]);
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

```bash
cd web && npm test 2>&1 | tail -20
```

Attendu : échec — `catalog()` ne prend pas d'argument et `honours_temperature` n'existe pas.

- [ ] **Step 3: Remplacer `shared/pricing.json`**

Écrire le fichier entier :

```json
{
  "_comment": "Lu par Python (backend/playground/pricing.py) et par TypeScript (web/lib/pricing.ts). Une seule source pour que le devis affiché avant un run et le coût calculé après ne puissent pas diverger.",
  "_comment_catalogue": "Règle d'entrée : un modèle de texte, qui accepte des outils, dont le tarif est publié, et qui a réellement répondu à un appel outillé passé par inspect_ai. Voir docs/superpowers/specs/2026-09-07-catalogue-et-favoris-design.md pour ce qui est resté dehors et pourquoi.",
  "_comment_temperature": "honours_temperature absent vaut true. false dit que le fournisseur jette le paramètre : Claude 4.7 et au-delà tournent en adaptive thinking et le refusent, inspect_ai le retire et journalise. L'appel réussit — c'est ce qui rend le piège traître, et pourquoi il est écrit ici.",
  "chars_per_token": 2.5,
  "default_response_tokens": 1100,
  "short_response_tokens": 200,
  "long_response_tokens": 6000,
  "judge_response_tokens": 200,
  "usd_to_eur": 0.92,
  "cache_read_multiplier": 0.1,
  "cache_write_multiplier": 1.25,
  "prices": {
    "anthropic/claude-fable-5-1": { "input_per_mtok": 10.0, "output_per_mtok": 50.0 },
    "anthropic/claude-fable-5": { "input_per_mtok": 10.0, "output_per_mtok": 50.0 },
    "anthropic/claude-opus-5": { "input_per_mtok": 5.0, "output_per_mtok": 25.0 },
    "anthropic/claude-opus-4-8": { "input_per_mtok": 5.0, "output_per_mtok": 25.0 },
    "anthropic/claude-opus-4-7": { "input_per_mtok": 5.0, "output_per_mtok": 25.0 },
    "anthropic/claude-opus-4-6": { "input_per_mtok": 5.0, "output_per_mtok": 25.0 },
    "anthropic/claude-opus-4-5": { "input_per_mtok": 5.0, "output_per_mtok": 25.0 },
    "anthropic/claude-sonnet-5": { "input_per_mtok": 2.0, "output_per_mtok": 10.0 },
    "anthropic/claude-sonnet-4-6": { "input_per_mtok": 3.0, "output_per_mtok": 15.0 },
    "anthropic/claude-sonnet-4-5": { "input_per_mtok": 3.0, "output_per_mtok": 15.0 },
    "anthropic/claude-haiku-4-5": { "input_per_mtok": 1.0, "output_per_mtok": 5.0 },
    "openai/gpt-6-astra": { "input_per_mtok": 10.0, "output_per_mtok": 50.0 },
    "openai/gpt-5.6-sol": { "input_per_mtok": 4.0, "output_per_mtok": 20.0 },
    "openai/gpt-5.6-terra": { "input_per_mtok": 2.0, "output_per_mtok": 12.0 },
    "openai/gpt-5.6-luna": { "input_per_mtok": 0.2, "output_per_mtok": 1.2 },
    "openai/gpt-5.5": { "input_per_mtok": 5.0, "output_per_mtok": 30.0 },
    "openai/gpt-5.4": { "input_per_mtok": 2.5, "output_per_mtok": 15.0 },
    "openai/gpt-5.4-mini": { "input_per_mtok": 0.75, "output_per_mtok": 4.5 },
    "openai/gpt-5.4-nano": { "input_per_mtok": 0.2, "output_per_mtok": 1.25 },
    "openai/gpt-5.2": { "input_per_mtok": 1.75, "output_per_mtok": 14.0 },
    "openai/gpt-5.1": { "input_per_mtok": 1.25, "output_per_mtok": 10.0 },
    "openai/gpt-5": { "input_per_mtok": 1.25, "output_per_mtok": 10.0 },
    "openai/gpt-5-mini": { "input_per_mtok": 0.25, "output_per_mtok": 2.0 },
    "openai/gpt-5-nano": { "input_per_mtok": 0.05, "output_per_mtok": 0.4 },
    "openai/gpt-4.1": { "input_per_mtok": 2.0, "output_per_mtok": 8.0 },
    "openai/gpt-4.1-mini": { "input_per_mtok": 0.4, "output_per_mtok": 1.6 },
    "openai/gpt-4.1-nano": { "input_per_mtok": 0.1, "output_per_mtok": 0.4 },
    "openai/gpt-4o": { "input_per_mtok": 2.5, "output_per_mtok": 10.0 },
    "openai/gpt-4o-mini": { "input_per_mtok": 0.15, "output_per_mtok": 0.6 },
    "grok/grok-4.6": { "input_per_mtok": 2.0, "output_per_mtok": 6.0 },
    "grok/grok-4.5": { "input_per_mtok": 2.0, "output_per_mtok": 6.0 },
    "grok/grok-4.3": { "input_per_mtok": 1.25, "output_per_mtok": 2.5 },
    "grok/grok-4.20-0309-reasoning": { "input_per_mtok": 1.25, "output_per_mtok": 2.5 },
    "grok/grok-4.20-0309-non-reasoning": { "input_per_mtok": 1.25, "output_per_mtok": 2.5 },
    "google/gemini-3.8-flash": { "input_per_mtok": 0.75, "output_per_mtok": 3.75 },
    "google/gemini-3.7-flash": { "input_per_mtok": 0.75, "output_per_mtok": 3.75 },
    "google/gemini-3.6-flash": { "input_per_mtok": 0.75, "output_per_mtok": 3.75 },
    "google/gemini-3.5-flash": { "input_per_mtok": 1.5, "output_per_mtok": 9.0 },
    "google/gemini-3.5-flash-lite": { "input_per_mtok": 0.3, "output_per_mtok": 2.5 },
    "google/gemini-3.1-pro-preview": { "input_per_mtok": 2.0, "output_per_mtok": 12.0 },
    "google/gemini-3.1-flash-lite": { "input_per_mtok": 0.25, "output_per_mtok": 1.5 }
  },
  "providers": [
    {
      "id": "anthropic",
      "label": "Anthropic",
      "env_vars": ["ANTHROPIC_API_KEY"],
      "models": [
        { "id": "anthropic/claude-fable-5-1", "label": "Claude Fable 5.1", "honours_temperature": false },
        { "id": "anthropic/claude-fable-5", "label": "Claude Fable 5", "honours_temperature": false },
        { "id": "anthropic/claude-opus-5", "label": "Claude Opus 5", "honours_temperature": false },
        { "id": "anthropic/claude-opus-4-8", "label": "Claude Opus 4.8", "honours_temperature": false },
        { "id": "anthropic/claude-opus-4-7", "label": "Claude Opus 4.7", "honours_temperature": false },
        { "id": "anthropic/claude-opus-4-6", "label": "Claude Opus 4.6" },
        { "id": "anthropic/claude-opus-4-5", "label": "Claude Opus 4.5" },
        { "id": "anthropic/claude-sonnet-5", "label": "Claude Sonnet 5", "honours_temperature": false },
        { "id": "anthropic/claude-sonnet-4-6", "label": "Claude Sonnet 4.6" },
        { "id": "anthropic/claude-sonnet-4-5", "label": "Claude Sonnet 4.5" },
        { "id": "anthropic/claude-haiku-4-5", "label": "Claude Haiku 4.5" }
      ]
    },
    {
      "id": "openai",
      "label": "OpenAI",
      "env_vars": ["OPENAI_API_KEY"],
      "models": [
        { "id": "openai/gpt-6-astra", "label": "GPT-6 Astra", "honours_temperature": false },
        { "id": "openai/gpt-5.6-sol", "label": "GPT-5.6 Sol" },
        { "id": "openai/gpt-5.6-terra", "label": "GPT-5.6 Terra" },
        { "id": "openai/gpt-5.6-luna", "label": "GPT-5.6 Luna" },
        { "id": "openai/gpt-5.5", "label": "GPT-5.5" },
        { "id": "openai/gpt-5.4", "label": "GPT-5.4" },
        { "id": "openai/gpt-5.4-mini", "label": "GPT-5.4 mini" },
        { "id": "openai/gpt-5.4-nano", "label": "GPT-5.4 nano" },
        { "id": "openai/gpt-5.2", "label": "GPT-5.2" },
        { "id": "openai/gpt-5.1", "label": "GPT-5.1" },
        { "id": "openai/gpt-5", "label": "GPT-5" },
        { "id": "openai/gpt-5-mini", "label": "GPT-5 mini" },
        { "id": "openai/gpt-5-nano", "label": "GPT-5 nano" },
        { "id": "openai/gpt-4.1", "label": "GPT-4.1" },
        { "id": "openai/gpt-4.1-mini", "label": "GPT-4.1 mini" },
        { "id": "openai/gpt-4.1-nano", "label": "GPT-4.1 nano" },
        { "id": "openai/gpt-4o", "label": "GPT-4o" },
        { "id": "openai/gpt-4o-mini", "label": "GPT-4o mini" }
      ]
    },
    {
      "id": "grok",
      "label": "xAI (Grok)",
      "env_vars": ["XAI_API_KEY", "GROK_API_KEY"],
      "models": [
        { "id": "grok/grok-4.6", "label": "Grok 4.6" },
        { "id": "grok/grok-4.5", "label": "Grok 4.5" },
        { "id": "grok/grok-4.3", "label": "Grok 4.3" },
        { "id": "grok/grok-4.20-0309-reasoning", "label": "Grok 4.20 (reasoning)" },
        { "id": "grok/grok-4.20-0309-non-reasoning", "label": "Grok 4.20 (non-reasoning)" }
      ]
    },
    {
      "id": "google",
      "label": "Google (Gemini)",
      "env_vars": ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
      "models": [
        { "id": "google/gemini-3.8-flash", "label": "Gemini 3.8 Flash" },
        { "id": "google/gemini-3.7-flash", "label": "Gemini 3.7 Flash" },
        { "id": "google/gemini-3.6-flash", "label": "Gemini 3.6 Flash" },
        { "id": "google/gemini-3.5-flash", "label": "Gemini 3.5 Flash" },
        { "id": "google/gemini-3.5-flash-lite", "label": "Gemini 3.5 Flash-Lite" },
        { "id": "google/gemini-3.1-pro-preview", "label": "Gemini 3.1 Pro (preview)" },
        { "id": "google/gemini-3.1-flash-lite", "label": "Gemini 3.1 Flash-Lite" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Étendre `ModelOption` côté TypeScript**

Dans `web/lib/types.ts`, remplacer l'interface `ModelOption` par :

```typescript
export interface ModelOption {
  id: string;
  label: string;
  /** Prix en dollars par million de jetons, ou null si le modèle n'est pas tarifé. */
  input_per_mtok: number | null;
  output_per_mtok: number | null;
  /** Le fournisseur tient-il compte de la température qu'on lui envoie ?
   *
   * `false` ne veut pas dire que l'appel échoue : Claude 4.7 et au-delà
   * tournent en adaptive thinking et refusent le paramètre, `inspect_ai` le
   * retire et l'appel réussit sans lui. C'est ce qui rend le piège traître —
   * un balayage de température sur ces modèles ne mesure que du bruit, et
   * rien dans la réponse ne le dit. */
  honours_temperature: boolean;
  /** Ce modèle est-il dans les favoris de qui regarde ?
   *
   * Posé par `catalog()` à partir de la liste qu'on lui passe, jamais lu
   * dans le fichier partagé : les favoris sont propres à une personne, le
   * catalogue est commun à tout le monde. */
  favorite: boolean;
}
```

- [ ] **Step 5: Faire prendre les favoris à `catalog()`**

Dans `web/lib/catalog.ts`, remplacer la fonction `catalog` par :

```typescript
/** Le catalogue tel qu'un écran l'affiche, marqué pour qui regarde.
 *
 * `favorites` est exigé plutôt que facultatif : chaque appelant a une
 * réponse à cette question — les favoris de l'appelant, ou le défaut du
 * code pour une route publique — et un défaut implicite ici ferait passer
 * l'oubli pour un choix. */
export function catalog(favorites: readonly string[]): ProviderInfo[] {
  const informed = canSeeProviderKeys();
  const preferred = new Set(favorites);
  return SHARED_PRICING.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    env_vars: provider.env_vars,
    // Quand on ne peut pas savoir, on ne grise pas : une clé manquante se
    // verra de toute façon, en cases rouges portant l'erreur du fournisseur.
    // Griser à tort empêcherait de lancer un run parfaitement valide.
    key_present: informed
      ? provider.env_vars.some((name) => Boolean(process.env[name]))
      : true,
    models: provider.models.map((model) => {
      const price = SHARED_PRICING.prices[model.id as keyof typeof SHARED_PRICING.prices];
      const declared = (model as { honours_temperature?: boolean }).honours_temperature;
      return {
        id: model.id,
        label: model.label,
        input_per_mtok: price?.input_per_mtok ?? null,
        output_per_mtok: price?.output_per_mtok ?? null,
        // Absent vaut « oui » : la marque ne sert qu'à signaler l'exception,
        // et l'écrire sur trente-quatre entrées pour sept cas noierait le
        // signal dans le bruit.
        honours_temperature: declared !== false,
        favorite: preferred.has(model.id),
      };
    }),
  }));
}
```

- [ ] **Step 6: Lancer les tests TypeScript**

```bash
cd web && npm test 2>&1 | tail -20
```

Attendu : tous les tests de `catalog.test.mts` passent, et rien d'autre ne casse.

`node --test` retire les types sans les vérifier : les deux appelants qui passent encore `catalog()` sans argument — `web/app/api/catalog/route.ts` et `agentModels` dans `web/lib/agent-prompt.ts` — ne planteront donc pas. `new Set(undefined)` est un ensemble vide, et tout ressort simplement avec `favorite: false`, sans conséquence tant que personne ne filtre là-dessus.

`npx tsc --noEmit`, lui, signalera les deux arguments manquants. **C'est attendu à la fin de cette tâche**, et c'est la seule tâche du plan qui laisse le typage en défaut : la route est reprise à la Task 6, `agentModels` à la Task 7. Ne pas les corriger ici par anticipation — leur forme dépend de décisions que ces deux tâches portent.

- [ ] **Step 7: Étendre `ModelOption` côté Python**

Dans `backend/playground/catalog.py`, ajouter le champ à la classe `ModelOption`, après `output_per_mtok` :

```python
    honours_temperature: bool = True
    """Le fournisseur tient-il compte de la température qu'on lui envoie ?

    `False` ne dit pas que l'appel échoue : Claude 4.7 et au-delà tournent en
    adaptive thinking et refusent le paramètre, `inspect_ai` le retire et
    l'appel passe sans lui. L'écran s'en sert pour prévenir qu'un balayage de
    température sur ces modèles ne mesurerait que du bruit.

    Le défaut est `True` parce que le fichier partagé ne marque que
    l'exception — sept modèles sur quarante et un.
    """
```

`catalog()` n'a rien à changer : `ModelOption(**model, …)` reçoit déjà le champ quand il est écrit, et le défaut sinon.

- [ ] **Step 8: Mettre `tests/test_catalog.py` à jour**

Remplacer les deux tests qui comptent, et ajouter l'intégrité :

```python
def test_les_quatre_providers_sont_proposes(monkeypatch):
    _sans_cles(monkeypatch)
    assert [p.id for p in catalog()] == ["anthropic", "openai", "grok", "google"]


def test_le_catalogue_porte_quarante_et_un_modeles():
    assert len(known_model_ids()) == 41


def test_chaque_modele_propose_a_un_tarif():
    # Un modèle sans tarif est compté pour zéro par le devis : un run annoncé
    # gratuit et facturé plein.
    from playground.pricing import PRICES

    assert {m for m in known_model_ids() if m not in PRICES} == set()


def test_aucun_tarif_ne_traine_sans_modele():
    from playground.pricing import PRICES

    assert set(PRICES) - known_model_ids() == set()


def test_les_sept_modeles_qui_jettent_la_temperature_sont_marques():
    ignorants = sorted(
        m.id for p in catalog() for m in p.models if not m.honours_temperature
    )
    assert ignorants == [
        "anthropic/claude-fable-5",
        "anthropic/claude-fable-5-1",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-opus-5",
        "anthropic/claude-sonnet-5",
        "openai/gpt-6-astra",
    ]
```

Remplacer aussi la constante `CLES` en tête du fichier, sans quoi une clé Google présente dans l'environnement ferait passer `test_cle_absente_marque_le_provider_indisponible` pour faux :

```python
CLES = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "XAI_API_KEY",
    "GROK_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
]
```

Supprimer `test_neuf_modeles_connus_avec_prefixe_provider`, remplacé par les quatre tests ci-dessus.

- [ ] **Step 9: Lancer pytest**

```bash
.venv/bin/python -m pytest -q
```

Attendu : tout passe. Si `tests/test_pricing.py` échoue sur un tarif codé en dur, corriger l'attente vers la nouvelle valeur (`openai/gpt-5.6-sol` : 4/20 ; `anthropic/claude-sonnet-5` : 2/10) — ce sont les deux corrections voulues, pas des régressions.

- [ ] **Step 10: Commit**

```bash
git add shared/pricing.json backend/playground/catalog.py tests/test_catalog.py web/lib/types.ts web/lib/catalog.ts web/lib/catalog.test.mts
git commit -m "feat: quarante et un modèles, quatre fournisseurs, et la température qui ne fait rien"
```

---

### Task 3 : La colonne des favoris

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/20260907120000_profiles_favorite_models.sql`

**Interfaces:**
- Consumes: rien.
- Produces: `profiles.favorite_models text[]`, nullable, sans défaut.

- [ ] **Step 1: Écrire la migration**

Dans **le dépôt `polaris-supabase`**, créer le fichier :

```sql
-- evals-playground : les modèles que chacun veut voir, et rien d'autre.
--
-- Le catalogue passe de neuf à quarante et un modèles. Un menu de quarante et
-- une entrées est pire que neuf, et le prompt de l'agent, qui publie la liste
-- entière à chaque appel, serait long sans rien gagner. Chacun choisit donc ce
-- qu'il en voit.
--
-- NULL signifie « utilise le défaut du code ». Même convention que
-- scenario_advice sur cette table, et pour la même raison : recopier le défaut
-- dans chaque ligne priverait silencieusement des modèles qu'on ajoutera plus
-- tard toute personne n'ayant jamais touché à sa liste. Le défaut vit dans le
-- code ; seule la surcharge vit ici.
--
-- Un tableau vide n'est pas NULL et ne veut pas dire la même chose : il dirait
-- « aucun modèle », ce qui viderait tous les menus de l'application. La route
-- le refuse ; la base n'a pas à trancher un cas que le code sait mieux
-- nommer.
alter table profiles
  add column favorite_models text[];

comment on column profiles.favorite_models is
  'Les modèles que cette personne veut voir proposés. NULL signifie « utilise le défaut du code » — on ne recopie jamais le défaut ici, sans quoi l''enrichir n''atteindrait plus personne. Ne borne que ce qui est PROPOSÉ : la validation d''un run accepte tout le catalogue, et un run déjà lancé s''affiche avec ses modèles quoi qu''il arrive à cette liste.';
```

- [ ] **Step 2: Pousser la migration**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase
supabase db push --project-ref hkqzamibfpyvlowiqgpn
```

Attendu : la migration s'applique. Si la CLI demande de lier le projet, suivre la procédure du `README.md` de `polaris-supabase`.

- [ ] **Step 3: Vérifier la colonne**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/evals-playground
set -a && . ./.env && set +a
curl -s "$SUPABASE_URL/rest/v1/profiles?select=user_email,favorite_models&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

Attendu : un JSON portant `favorite_models: null`, pas une erreur de colonne inconnue.

- [ ] **Step 4: Commit dans `polaris-supabase`**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase
git add evals/supabase/migrations/20260907120000_profiles_favorite_models.sql
git commit -m "feat(evals): les favoris de modèles d'un profil"
```

---

### Task 4 : La résolution des favoris, sans Supabase

Un module pur, comme `profile-caps.ts` : la même règle sert au formulaire, qui refuse avant d'envoyer, et à la route, qui refuse même si le formulaire a été contourné.

**Files:**
- Create: `web/lib/favorite-models.ts`
- Create: `web/lib/favorite-models.test.mts`

**Interfaces:**
- Consumes: `knownModelIds(): Set<string>` de `./catalog.ts`.
- Produces :
  - `DEFAULT_FAVORITE_MODELS: readonly string[]` — dix identifiants.
  - `favoriteModels(profile: { favorite_models: string[] | null } | null): string[]`
  - `favoritesProblem(value: unknown): string | null`
  - `notFavouriteProblem(id: string, favorites: readonly string[], where: string): string | null`

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

Créer `web/lib/favorite-models.test.mts` :

```typescript
// Les favoris d'une personne, sans Supabase ni session : voir favorite-models.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FAVORITE_MODELS,
  favoriteModels,
  favoritesProblem,
  notFavouriteProblem,
} from "./favorite-models.ts";
import { knownModelIds } from "./catalog.ts";

test("le défaut ne nomme que des modèles du catalogue", () => {
  // Un défaut qui nomme un modèle disparu viderait les menus de tous ceux
  // qui n'ont jamais touché à leur liste.
  const known = knownModelIds();
  assert.deepEqual(DEFAULT_FAVORITE_MODELS.filter((id) => !known.has(id)), []);
});

test("le défaut porte dix modèles", () => {
  assert.equal(DEFAULT_FAVORITE_MODELS.length, 10);
});

test("NULL rend le défaut du code", () => {
  // Et non un tableau vide : c'est toute la convention de la colonne.
  assert.deepEqual(favoriteModels({ favorite_models: null }), [...DEFAULT_FAVORITE_MODELS]);
});

test("un profil illisible rend aussi le défaut", () => {
  // Ne pas savoir qui regarde n'est pas une raison de ne rien proposer.
  assert.deepEqual(favoriteModels(null), [...DEFAULT_FAVORITE_MODELS]);
});

test("une liste écrite rend cette liste", () => {
  assert.deepEqual(
    favoriteModels({ favorite_models: ["grok/grok-4.6"] }),
    ["grok/grok-4.6"],
  );
});

test("un favori retiré du catalogue depuis est écarté à la lecture", () => {
  // La liste est écrite à un instant ; le catalogue bouge sans elle. Servir
  // un identifiant qui n'existe plus mettrait dans un menu une entrée dont
  // le seul effet serait d'échouer au premier appel facturé.
  assert.deepEqual(
    favoriteModels({ favorite_models: ["grok/grok-4.6", "openai/gpt-disparu"] }),
    ["grok/grok-4.6"],
  );
});

test("une liste dont plus rien n'existe retombe sur le défaut", () => {
  // Pas un menu vide : l'application deviendrait inutilisable sans qu'on
  // puisse même deviner pourquoi.
  assert.deepEqual(
    favoriteModels({ favorite_models: ["openai/gpt-disparu"] }),
    [...DEFAULT_FAVORITE_MODELS],
  );
});

test("une liste valide est acceptée", () => {
  assert.equal(favoritesProblem(["anthropic/claude-opus-5", "grok/grok-4.6"]), null);
});

test("le tableau vide est refusé", () => {
  assert.notEqual(favoritesProblem([]), null);
});

test("ce qui n'est pas un tableau de chaînes est refusé", () => {
  assert.notEqual(favoritesProblem(null), null);
  assert.notEqual(favoritesProblem("anthropic/claude-opus-5"), null);
  assert.notEqual(favoritesProblem([1, 2]), null);
});

test("un identifiant hors catalogue est refusé, et nommé", () => {
  const problem = favoritesProblem(["anthropic/claude-opus-5", "openai/gpt-inconnu"]);
  assert.ok(problem?.includes("openai/gpt-inconnu"));
});

test("un doublon est refusé", () => {
  assert.notEqual(
    favoritesProblem(["grok/grok-4.6", "grok/grok-4.6"]),
    null,
  );
});

test("un favori ne pose aucun problème", () => {
  assert.equal(
    notFavouriteProblem("grok/grok-4.6", ["grok/grok-4.6"], "models.judge"),
    null,
  );
});

test("un modèle du catalogue hors favoris est refusé, en le disant", () => {
  // Le message doit distinguer les deux cas : « pas dans tes favoris » se
  // corrige depuis le profil, « n'existe pas » ne se corrige pas du tout.
  const problem = notFavouriteProblem(
    "openai/gpt-5.4",
    ["grok/grok-4.6"],
    "models.targets[0]",
  );
  assert.ok(problem?.includes("openai/gpt-5.4"));
  assert.ok(problem?.includes("models.targets[0]"));
  assert.ok(problem?.includes("favourite"));
  assert.ok(problem?.includes("profile"));
});

test("un modèle qui n'existe nulle part n'est pas l'affaire de cette fonction", () => {
  // `configProblem` l'a déjà refusé, avec son propre message. Un second
  // refus dirait « ajoute-le à tes favoris » pour un identifiant qu'aucun
  // profil ne pourra jamais contenir.
  assert.equal(
    notFavouriteProblem("openai/gpt-inconnu", ["grok/grok-4.6"], "models.judge"),
    null,
  );
});

test("une chaîne vide passe : le champ est facultatif", () => {
  assert.equal(notFavouriteProblem("", ["grok/grok-4.6"], "models.adversary"), null);
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

```bash
cd web && npm test 2>&1 | tail -20
```

Attendu : échec — `./favorite-models.ts` n'existe pas.

- [ ] **Step 3: Écrire le module**

Créer `web/lib/favorite-models.ts` :

```typescript
// Les modèles qu'une personne veut voir proposés, et rien d'autre.
//
// Le catalogue compte quarante et un modèles ; un menu de quarante et une
// entrées est pire que neuf. Chacun choisit donc ce qu'il en voit, et cette
// liste décide de tout ce qui PROPOSE — les écrans, le prompt de l'agent, les
// outils MCP.
//
// Ce qu'elle ne décide pas, jamais : ce qui EXISTE. `knownModelIds()` reste
// seule à répondre à cette question-là, et c'est elle que `configProblem`
// consulte. Un run déjà lancé s'affiche donc avec ses modèles quoi qu'il
// arrive aux favoris, et une relance humaine reste lançable.
//
// Sans Supabase ni session : la même règle sert au formulaire, qui refuse
// avant d'envoyer, et à la route, qui refuse même si le formulaire a été
// contourné.
import { knownModelIds } from "./catalog.ts";

/** Ce qu'on propose à qui n'a rien choisi.
 *
 * Les neuf modèles que le produit proposait quand le catalogue était écrit à
 * la main, plus Fable 5.1. Vit dans le code et non en base : une ligne de
 * `profiles` qui recopierait cette liste ne recevrait plus jamais ce qu'on y
 * ajoutera — voir la migration `profiles_favorite_models`, qui porte le même
 * raisonnement que `scenario_advice` avant elle. */
export const DEFAULT_FAVORITE_MODELS: readonly string[] = [
  "anthropic/claude-fable-5-1",
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
  "grok/grok-4.6",
  "grok/grok-4.5",
  "grok/grok-4.3",
];

/** Les modèles à proposer à cette personne.
 *
 * `null` — le profil absent comme la colonne vide — rend le défaut. Ne pas
 * savoir qui regarde n'est pas une raison de ne rien proposer : une route
 * publique comme `/prompt` passe ici sans profil et doit servir quelque
 * chose.
 *
 * Les identifiants qui ne sont plus au catalogue sont écartés à la lecture
 * plutôt qu'à l'écriture : la liste est écrite à un instant, le catalogue
 * bouge sans elle, et un menu ne doit pas porter une entrée dont le seul
 * effet serait d'échouer au premier appel facturé. Si le tri ne laisse rien,
 * on retombe sur le défaut — un menu vide rendrait l'application
 * inutilisable sans qu'on puisse deviner pourquoi. */
export function favoriteModels(
  profile: { favorite_models: string[] | null } | null,
): string[] {
  const written = profile?.favorite_models;
  if (!written) return [...DEFAULT_FAVORITE_MODELS];
  const known = knownModelIds();
  const alive = written.filter((id) => known.has(id));
  return alive.length > 0 ? alive : [...DEFAULT_FAVORITE_MODELS];
}

/** `null` si `value` peut devenir une liste de favoris, sinon ce qui cloche.
 *
 * Le tableau vide est refusé ici plutôt qu'en base : la contrainte se dit
 * mieux en une phrase qu'en SQL, et c'est cette phrase que le formulaire
 * affiche. Sans un seul favori, tous les menus de l'application seraient
 * vides.
 *
 * Un doublon est refusé plutôt que dédoublonné en silence : il vient d'un
 * client qui s'est trompé, et le corriger sans le dire cache l'erreur. */
export function favoritesProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) {
    return "favorite_models must be an array of model identifiers";
  }
  const ids = value as string[];
  if (ids.length === 0) {
    return "keep at least one model: with none, every model menu in the app would be empty";
  }
  if (new Set(ids).size !== ids.length) {
    return "favorite_models lists the same model twice";
  }
  const known = knownModelIds();
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    return `not models this tool can run: ${unknown.join(", ")}`;
  }
  return null;
}

/** Le refus d'un modèle qui existe mais que cette personne ne s'est pas
 *  choisi, ou `null`.
 *
 * Ne dit rien d'un identifiant hors catalogue : `configProblem` l'a déjà
 * refusé avec son propre message, et lui répondre « ajoute-le à tes
 * favoris » enverrait corriger un profil qui ne pourra jamais le contenir.
 * Les deux refus sont distincts parce que les deux gestes de réparation le
 * sont.
 *
 * Une chaîne vide passe : plusieurs champs de modèle sont facultatifs, et un
 * champ absent n'est pas un modèle refusé. */
export function notFavouriteProblem(
  id: string,
  favorites: readonly string[],
  where: string,
): string | null {
  if (!id.trim()) return null;
  if (favorites.includes(id)) return null;
  if (!knownModelIds().has(id)) return null;
  return (
    `${where}: "${id}" exists, but it is not in your favourite models — it may have been ` +
    "before. Add it back in your profile to use it."
  );
}
```

- [ ] **Step 4: Lancer les tests**

```bash
cd web && npm test 2>&1 | tail -20
```

Attendu : les seize tests de `favorite-models.test.mts` passent.

- [ ] **Step 5: Commit**

```bash
git add web/lib/favorite-models.ts web/lib/favorite-models.test.mts
git commit -m "feat: les favoris de modèles, leur défaut et leurs refus"
```

---

### Task 5 : Le profil lit et écrit ses favoris

**Files:**
- Modify: `web/lib/types.ts` (interface `Profile`)
- Modify: `web/lib/profiles.ts` (ajout d'`updateFavoriteModels`)
- Modify: `web/lib/profile-caps.ts:38-60` (`profilePatchProblem`)
- Modify: `web/lib/profile-caps.test.mts` (les nouveaux cas d'exclusion)
- Modify: `web/app/api/profile/route.ts` (branche PATCH)
- Modify: `web/lib/api.ts` (client)

**Interfaces:**
- Consumes: `favoritesProblem` de `./favorite-models.ts`, `ensureProfile`/`update`/`PROFILES` de `./profiles.ts` et `./supabase.ts`.
- Produces :
  - `Profile.favorite_models: string[] | null`
  - `updateFavoriteModels(email: string, models: string[]): Promise<Profile>`
  - client : `updateProfileFavorites(favorite_models: string[]): Promise<{ profile: Profile }>`

- [ ] **Step 1: Écrire les tests d'exclusion, qui doivent échouer**

Ajouter à la fin de `web/lib/profile-caps.test.mts` :

```typescript
test("favorite_models ne voyage pas avec les plafonds", () => {
  // Même raison que le conseil de scénario : la route applique une chose ou
  // l'autre, et choisir laquelle écraser serait arbitraire pour qui envoie.
  assert.notEqual(
    profilePatchProblem({ favorite_models: ["grok/grok-4.6"], max_usd_per_run: 2 }),
    null,
  );
});

test("favorite_models ne voyage pas avec le conseil de scénario", () => {
  assert.notEqual(
    profilePatchProblem({ favorite_models: ["grok/grok-4.6"], scenario_advice: "x" }),
    null,
  );
});

test("favorite_models seul passe", () => {
  assert.equal(profilePatchProblem({ favorite_models: ["grok/grok-4.6"] }), null);
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

```bash
cd web && npm test 2>&1 | grep -A 3 "favorite_models"
```

Attendu : les deux premiers échouent — `profilePatchProblem` ignore encore `favorite_models`.

- [ ] **Step 3: Étendre `profilePatchProblem`**

Dans `web/lib/profile-caps.ts`, remplacer le corps de `profilePatchProblem` par :

```typescript
export function profilePatchProblem(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as {
    scenario_advice?: unknown;
    favorite_models?: unknown;
    max_usd_per_run?: unknown;
    max_usd_per_hour?: unknown;
  };
  // Trois réglages indépendants, une seule route : chacun arrive de son
  // propre écran et aucun n'a à connaître les autres. Un corps qui en porte
  // deux est refusé plutôt que d'en dédouaner un en silence.
  const sent = [
    b.scenario_advice !== undefined,
    b.favorite_models !== undefined,
    b.max_usd_per_run !== undefined || b.max_usd_per_hour !== undefined,
  ].filter(Boolean).length;
  if (sent > 1) {
    return "Send the spending caps, the scenario advice and the favourite models in separate requests — this route applies one of the three, and silently dropping the rest of what you sent would be worse than refusing it.";
  }
  return null;
}
```

Mettre aussi à jour la docstring juste au-dessus pour qu'elle parle de trois réglages et non de deux.

- [ ] **Step 4: Étendre `Profile`**

Dans `web/lib/types.ts`, ajouter le champ à l'interface `Profile`, après `scenario_advice` :

```typescript
  /** Les modèles que cette personne veut voir proposés.
   *
   * `null` — le cas courant — veut dire « utilise le défaut du code », par
   * `favoriteModels` dans `favorite-models.ts`. Le défaut n'est jamais
   * recopié ici, pour la même raison que `scenario_advice` : l'enrichir
   * n'atteindrait plus personne. Ne borne que ce qui est PROPOSÉ ; la
   * validation d'un run, elle, accepte tout le catalogue. */
  favorite_models: string[] | null;
```

- [ ] **Step 5: Écrire `updateFavoriteModels`**

Ajouter à la fin de `web/lib/profiles.ts` :

```typescript
/** Écrit les favoris de `email`, depuis l'écran de profil.
 *
 * Ne valide rien : `favoritesProblem`, dans `favorite-models.ts`, l'a déjà
 * fait avant d'arriver ici, côté route comme côté formulaire.
 *
 * N'écrit jamais `null` : remettre le défaut se fait en cochant ce qu'on
 * veut, pas en vidant la liste — et une liste vide est refusée en amont. La
 * colonne ne redevient `null` que si personne n'y a jamais touché.
 *
 * Relit après coup pour la même raison qu'`updateProfileCaps` :
 * `ensureProfile` est la seule fonction qui sache refaire exister la ligne. */
export async function updateFavoriteModels(
  email: string,
  models: string[],
): Promise<Profile> {
  await update(PROFILES, { favorite_models: models }, { user_email: `eq.${email}` });
  return ensureProfile(email);
}
```

- [ ] **Step 6: Brancher la route PATCH**

Dans `web/app/api/profile/route.ts` :

1. Étendre l'import : `import { ensureProfile, updateFavoriteModels, updateProfileCaps, updateScenarioAdvice } from "@/lib/profiles";`
2. Ajouter `import { favoritesProblem } from "@/lib/favorite-models";`
3. Ajouter `favorite_models?: unknown;` au type du `body`.
4. Insérer, juste après le bloc `if (body.scenario_advice !== undefined) { … }` :

```typescript
  if (body.favorite_models !== undefined) {
    const problem = favoritesProblem(body.favorite_models);
    if (problem) return NextResponse.json({ error: problem }, { status: 422 });
    const profile = await updateFavoriteModels(
      user.email,
      body.favorite_models as string[],
    );
    return NextResponse.json({ profile });
  }
```

- [ ] **Step 7: Ajouter la fonction client**

Dans `web/lib/api.ts`, à côté d'`updateProfileCaps` :

```typescript
/** Écrit les favoris de qui est connecté. Envoyés seuls : la route applique
 *  un réglage à la fois — voir `profilePatchProblem`. */
export const updateProfileFavorites = (favorite_models: string[]) =>
  request<{ profile: Profile }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ favorite_models }),
  });
```

- [ ] **Step 8: Lancer les tests**

```bash
cd web && npm test 2>&1 | tail -10
```

Attendu : tout passe, dont les trois nouveaux cas d'exclusion.

- [ ] **Step 9: Commit**

```bash
git add web/lib/types.ts web/lib/profiles.ts web/lib/profile-caps.ts web/lib/profile-caps.test.mts web/app/api/profile/route.ts web/lib/api.ts
git commit -m "feat: un profil porte ses favoris, et la route en écrit un réglage à la fois"
```

---

### Task 6 : La route du catalogue marque les favoris de qui demande

**Files:**
- Modify: `web/app/api/catalog/route.ts`

**Interfaces:**
- Consumes: `catalog(favorites)`, `favoriteModels(profile)`, `ensureProfile(email)`.
- Produces: `GET /api/catalog` → `ProviderInfo[]` dont chaque `ModelOption` porte `favorite` et `honours_temperature`. Un seul aller-retour pour les écrans, qui ont besoin des deux.

- [ ] **Step 1: Réécrire la route**

Remplacer le contenu de `web/app/api/catalog/route.ts` par :

```typescript
import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { catalog } from "@/lib/catalog";
import { favoriteModels } from "@/lib/favorite-models";
import { ensureProfile } from "@/lib/profiles";

/** Le catalogue entier, marqué pour qui demande.
 *
 * Entier et non filtré : les écrans ont besoin des deux listes — ce qu'ils
 * proposent, et ce qu'ils affichent quand un run déjà lancé porte un modèle
 * qui a quitté les favoris. Filtrer ici obligerait un second aller-retour
 * pour retrouver le nom d'un modèle qu'on a sous les yeux.
 *
 * Un profil illisible ne fait pas échouer la route : `favoriteModels(null)`
 * rend le défaut du code. Ne pas savoir qui regarde n'est pas une raison de
 * ne rien proposer. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const profile = await ensureProfile(user.email).catch(() => null);
  return NextResponse.json(catalog(favoriteModels(profile)));
}
```

- [ ] **Step 2: Vérifier que le projet compile**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20
```

Attendu : les seules erreurs restantes concernent les appelants de `catalog()` sans argument (`agent-prompt.ts`) et les écrans — traités aux Tasks 7 et 8. Aucune erreur dans `route.ts`.

- [ ] **Step 3: Commit**

```bash
git add web/app/api/catalog/route.ts
git commit -m "feat: le catalogue arrive marqué des favoris de qui le demande"
```

---

### Task 7 : Le prompt de l'agent ne publie que les favoris

**Files:**
- Modify: `web/lib/agent-prompt.ts:560-570` (`agentModels`)
- Modify: `web/app/prompt/route.ts`
- Modify: `web/app/mcp/route.ts` (l'outil `read_prompt`, vers la ligne 264)
- Modify: `web/lib/agent-prompt.test.mts`

**Interfaces:**
- Consumes: `catalog(favorites)`, `DEFAULT_FAVORITE_MODELS`, `favoriteModels`.
- Produces: `agentModels(favorites: readonly string[]): { id: string; label: string }[]` — l'ordre suit le catalogue, filtré aux favoris.

- [ ] **Step 1: Écrire le test, qui doit échouer**

Ajouter à `web/lib/agent-prompt.test.mts` :

```typescript
test("agentModels ne publie que les favoris qu'on lui passe", () => {
  // Le prompt publie la liste entière à chaque appel : un agent ne doit y
  // lire que ce qu'il a le droit de lancer, sans quoi il proposera un modèle
  // que submit_draft_run refusera.
  const models = agentModels(["grok/grok-4.6", "anthropic/claude-opus-5"]);
  assert.deepEqual(
    models.map((m) => m.id).sort(),
    ["anthropic/claude-opus-5", "grok/grok-4.6"],
  );
});

test("agentModels garde l'ordre du catalogue, pas celui des favoris", () => {
  // Anthropic vient avant xAI dans le catalogue ; l'ordre des favoris ne
  // doit pas faire varier un texte que deux appels doivent rendre identique.
  const models = agentModels(["grok/grok-4.6", "anthropic/claude-opus-5"]);
  assert.deepEqual(models.map((m) => m.id), [
    "anthropic/claude-opus-5",
    "grok/grok-4.6",
  ]);
});

test("agentModels étiquette le fournisseur avec le modèle", () => {
  const [only] = agentModels(["anthropic/claude-opus-5"]);
  assert.equal(only.label, "Anthropic Claude Opus 5");
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

```bash
cd web && npm test 2>&1 | grep -A 3 "agentModels"
```

Attendu : échec — `agentModels` ne prend pas d'argument.

- [ ] **Step 3: Filtrer `agentModels`**

Dans `web/lib/agent-prompt.ts`, remplacer la fonction `agentModels` par :

```typescript
/** Les modèles que le prompt publie, sous la forme que lit `agentPrompt` —
 *  partagée entre `/prompt` et l'outil MCP `read_prompt`, pour qu'une seule
 *  liste existe.
 *
 * Filtrée aux favoris de l'appelant : le prompt dit « Use these identifiers
 * exactly », et un agent qui y lirait un modèle que `submit_draft_run`
 * refuse ensuite aurait été envoyé dans le mur par le texte lui-même.
 *
 * L'ordre reste celui du catalogue, jamais celui des favoris : deux appels
 * doivent rendre le même texte, et une liste réordonnée en base ferait
 * varier un document qui ne change pas de sens. */
export function agentModels(
  favorites: readonly string[],
): { id: string; label: string }[] {
  return catalog(favorites)
    .flatMap((provider) =>
      provider.models.map((model) => ({
        id: model.id,
        label: `${provider.label} ${model.label}`,
        favorite: model.favorite,
      })),
    )
    .filter((model) => model.favorite)
    .map(({ id, label }) => ({ id, label }));
}
```

- [ ] **Step 4: Servir le défaut sur `/prompt`**

Dans `web/app/prompt/route.ts` :

1. Ajouter `import { DEFAULT_FAVORITE_MODELS } from "@/lib/favorite-models";`
2. Remplacer l'appel dans `GET` par `agentPrompt(agentModels(DEFAULT_FAVORITE_MODELS), originOf(request))`.
3. Remplacer le paragraphe de la docstring qui commence par « Volontairement hors de la porte » par :

```typescript
/** Le prompt d'aide à la rédaction d'un run, en texte brut et sans connexion.
 *
 * Volontairement hors de la porte : le but est de donner cette URL à un agent,
 * qui n'a pas de session et ne saurait pas en obtenir une. Ce qu'elle rend ne
 * contient rien de privé — un texte fixe, plus la liste des modèles par
 * défaut, qui vient de `shared/pricing.json`, un fichier de ce dépôt public.
 *
 * Le défaut, et jamais les favoris de quelqu'un : sans session on ne sait pas
 * qui demande, donc rien qui dépende de qui demande ne peut sortir ici — la
 * même règle que `/scenario-advice`, qui sert le conseil par défaut pour
 * cette raison exacte. L'agent qui passe par MCP, lui, est identifié, et
 * `read_prompt` lui rend sa propre liste.
 *
 * En `text/plain` parce que le lecteur est une machine : du HTML lui ferait
 * traverser une mise en page pour retrouver le texte qu'on lui destine. */
```

- [ ] **Step 5: Servir les favoris de l'appelant sur `read_prompt`**

Dans `web/app/mcp/route.ts`, ajouter `favoriteModels` à l'import de `@/lib/favorite-models` (ou créer l'import), puis remplacer la ligne de retour de l'outil `read_prompt` par :

```typescript
      return {
        content: [
          {
            type: "text",
            // Les favoris de l'appelant, pas le défaut : c'est cette liste
            // que `submit_draft_run` fera respecter quelques appels plus
            // loin, et publier autre chose l'enverrait proposer un modèle
            // qu'il se verra refuser.
            text: mcpAgentPrompt(agentModels(favoriteModels(profile)), caps),
          },
        ],
      };
```

- [ ] **Step 6: Lancer les tests**

```bash
cd web && npm test 2>&1 | tail -10
```

Attendu : tout passe. Si un test existant d'`agent-prompt.test.mts` appelait `agentModels()` sans argument, lui passer `DEFAULT_FAVORITE_MODELS`.

- [ ] **Step 7: Vérifier le prompt à l'œil**

```bash
cd web && npx tsc --noEmit 2>&1 | grep -c "error" || echo "0 erreur"
```

Attendu : seules les erreurs des écrans (Task 8) subsistent.

- [ ] **Step 8: Commit**

```bash
git add web/lib/agent-prompt.ts web/lib/agent-prompt.test.mts web/app/prompt/route.ts web/app/mcp/route.ts
git commit -m "feat: le prompt publie les favoris de qui le lit, le défaut sans session"
```

---

### Task 8 : Les écrans ne proposent que les favoris

**Files:**
- Modify: `web/app/page.tsx` — la construction de `modelRows`, la fonction `single()`, les cases des modèles évalués, la section « Temperature of the evaluated model »
- Modify: `web/components/ExtendPanel.tsx` — le `<select>` « Add another model… »
- Modify: `web/app/eval/[runId]/page.tsx` — la ligne `const models = [...new Set([...config.models.targets, config.models.judge])];` du formulaire « Add a judge »

Repérer chaque endroit par `grep`, pas par numéro de ligne : ces fichiers ont bougé au commit `8294524` et bougeront encore. `page.tsx` garde bien son `getCatalog()` local et son état `providers` — le refactor des caches ne l'a pas touché.

**Interfaces:**
- Consumes: `GET /api/catalog` via `getCatalog()`, dont chaque modèle porte `favorite` et `honours_temperature`.
- Produces: aucun export nouveau ; trois écrans qui filtrent.

- [ ] **Step 1: Filtrer les lignes de la page de run**

Dans `web/app/page.tsx`, remplacer la construction de `modelRows` par :

```typescript
  // Les favoris seulement — plus, s'il y a lieu, les modèles que ce
  // formulaire porte déjà. Une relance pré-remplie peut nommer un modèle
  // qui a quitté les favoris depuis : le retirer du menu rendrait le
  // formulaire inutilisable sans dire pourquoi. On le garde, et on le dit.
  const chosen = new Set([...targets, adversary, judge].filter(Boolean));
  const modelRows = providers.flatMap((provider) =>
    provider.models
      .filter((model) => model.favorite || chosen.has(model.id))
      .map((model) => ({
        id: model.id,
        label: `${provider.label} — ${model.label}`,
        available: provider.key_present,
        missing: provider.env_vars.join(" or "),
        outsideFavourites: !model.favorite,
        honoursTemperature: model.honours_temperature,
        price:
          model.input_per_mtok === null || model.output_per_mtok === null
            ? null
            : `in $${model.input_per_mtok.toFixed(2)} · out $${model.output_per_mtok.toFixed(2)} /Mtok`,
      })),
  );
```

- [ ] **Step 2: Dire dans le menu ce qui est hors favoris**

Dans la fonction `single` de `web/app/page.tsx`, remplacer le contenu de l'`<option>` par :

```tsx
          <option key={m.id} value={m.id} disabled={!m.available}>
            {m.label}
            {m.price ? ` — ${m.price}` : ""}
            {m.outsideFavourites ? " — not in your favourites" : ""}
            {m.available ? "" : ` (${m.missing} missing)`}
          </option>
```

Faire de même dans le `<span className="flex-1">` des cases à cocher des modèles évalués :

```tsx
                <span className="flex-1">
                  {m.label}
                  {m.outsideFavourites ? " — not in your favourites" : ""}
                  {m.available ? "" : ` (${m.missing} missing)`}
                </span>
```

- [ ] **Step 3: Poser la note et le lien vers le profil**

Dans `web/app/page.tsx`, juste sous le `<span className="text-sm font-medium">Evaluated models — one column per model in the results</span>`, insérer :

```tsx
          <p className="text-sm text-zinc-600">
            Only your favourite models are listed.{" "}
            <a href="/profile" className="underline hover:text-zinc-900">
              Change which models you see
            </a>
            .
          </p>
```

- [ ] **Step 4: Prévenir quand un modèle choisi jette la température**

Dans `web/app/page.tsx`, dans la section « Temperature of the evaluated model », juste avant le `<p className="text-sm text-zinc-600">` qui parle de l'adversaire et du juge, insérer :

```tsx
        {(() => {
          // Ces modèles acceptent l'appel et jettent le paramètre : Claude 4.7
          // et au-delà tournent en adaptive thinking et le refusent, inspect le
          // retire, et rien dans la réponse ne le dit. Un balayage sur eux ne
          // mesure que du bruit — on le dit ici plutôt que de griser le
          // réglage, parce qu'une température fixe sur eux reste légitime.
          const deaf = modelRows.filter(
            (m) => targets.includes(m.id) && !m.honoursTemperature,
          );
          if (deaf.length === 0) return null;
          return (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              {deaf.map((m) => m.label).join(", ")}
              {deaf.length > 1 ? " ignore" : " ignores"} temperature — the
              provider runs them at its own setting. Their answers will still
              vary between repetitions, but not because of this control.
            </p>
          );
        })()}
```

- [ ] **Step 5: Filtrer le panneau d'extension**

Dans `web/components/ExtendPanel.tsx`, remplacer le `<select>` d'ajout de modèle par :

```tsx
            <select
              className={`${FIELD} cursor-pointer`}
              value=""
              onChange={(e) => {
                if (e.target.value) setTargets((c) => toggle(c, e.target.value));
              }}
            >
              <option value="">Add another model…</option>
              {catalog.flatMap((provider) =>
                provider.models
                  // Les favoris seulement : ce menu ajoute des colonnes à un
                  // run, donc il propose — et ce qu'on propose suit les
                  // favoris partout dans l'application.
                  .filter((model) => model.favorite && !targets.includes(model.id))
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {provider.label} · {model.label}
                    </option>
                  )),
              )}
            </select>
```

- [ ] **Step 6: Ouvrir le menu « Add a judge » aux favoris**

Dans `web/app/eval/[runId]/page.tsx`, le composant qui porte « Add a judge » lit aujourd'hui `const models = [...new Set([...config.models.targets, config.models.judge])];`.

Ajouter en tête du fichier `import { getCatalog } from "@/lib/api";` s'il n'y est pas, et `import type { ProviderInfo } from "@/lib/types";`. Puis, dans ce composant, remplacer la ligne `models` par :

```tsx
  // Le catalogue, pour ne pas enfermer un juge dans les modèles du run : on
  // ajoute un juge précisément pour regarder autrement, et le meilleur
  // modèle pour ça n'est pas forcément une des colonnes déjà jouées.
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  useEffect(() => {
    getCatalog().then(setProviders).catch(() => setProviders([]));
  }, []);

  // Les favoris, plus les modèles du run : ceux-ci restent proposables même
  // s'ils ont quitté les favoris depuis, sans quoi on ne pourrait plus
  // ajouter un juge tournant sur le même modèle que le principal.
  const models = [
    ...new Set([
      ...providers.flatMap((p) => p.models.filter((m) => m.favorite).map((m) => m.id)),
      ...config.models.targets,
      config.models.judge,
    ]),
  ];
```

- [ ] **Step 7: Vérifier la compilation et le lint**

```bash
cd web && npx tsc --noEmit 2>&1 | head -20 && npx eslint app lib components 2>&1 | tail -10
```

Attendu : aucune erreur.

- [ ] **Step 8: Vérifier à l'écran**

```bash
scripts/dev.sh
```

Ouvrir `http://localhost:3000`, et vérifier : dix modèles proposés et non quarante et un ; la ligne « Only your favourite models are listed » avec son lien ; le bandeau ambre sur la température dès que Claude Opus 5 est coché.

- [ ] **Step 9: Commit**

```bash
git add web/app/page.tsx web/components/ExtendPanel.tsx "web/app/eval/[runId]/page.tsx"
git commit -m "feat: les écrans ne proposent que les favoris, et disent qui ignore la température"
```

---

### Task 9 : L'écran de profil, où l'on choisit

**Files:**
- Modify: `web/app/profile/page.tsx`

**Interfaces:**
- Consumes: `getCatalog()`, `getProfile()`, `updateProfileFavorites()`, `favoritesProblem` (pour désactiver « Save » avec la même règle que la route).
- Produces: aucun export.

**Lire d'abord le fichier tel qu'il est.** Cette page a été refondue depuis
(commits `8294524` et `4eb76c5`) : elle ne fait plus `getProfile()`, elle lit
`useProfile()` depuis le cache de `web/lib/profile-store.ts`, et `loadError`
appartient au cache — il n'y a **pas** de `setLoadError` ni de `setProfile` à
appeler. La section des favoris se greffe sur ce patron-là, pas sur l'ancien.

Le catalogue, lui, n'a pas de cache : `web/app/page.tsx` le lit avec un
`getCatalog()` local et un `useState`, et cette page fait pareil. Ne pas créer
un cinquième cache — une navigation remonte la page et refait la lecture, donc
rien n'est périmé, et un cache de plus serait du confort que personne n'a
demandé.

- [ ] **Step 1: Ajouter l'état et le chargement**

Dans `web/app/profile/page.tsx`, étendre les imports existants :

```typescript
import { getCatalog, updateProfileCaps, updateProfileFavorites } from "@/lib/api";
import { favoritesProblem } from "@/lib/favorite-models";
import type { ProviderInfo } from "@/lib/types";
```

Ajouter l'état, sous celui des plafonds :

```typescript
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [savingFavorites, setSavingFavorites] = useState(false);
  const [savedFavorites, setSavedFavorites] = useState(false);
  // Son propre message d'erreur, et pas `loadError` : celui-là appartient au
  // cache du profil, qui n'est pas au courant de cette lecture-ci.
  const [favoritesError, setFavoritesError] = useState<string | null>(null);
```

Charger le catalogue dans un second effet, à côté du `void refreshProfile()`
déjà présent :

```typescript
  useEffect(() => {
    getCatalog()
      .then((catalog) => {
        setProviders(catalog);
        // Les favoris viennent du catalogue marqué, pas de `profile` :
        // `favorite_models` peut être `null` (le défaut du code) ou porter un
        // modèle retiré du catalogue depuis, et c'est la route qui a déjà
        // résolu les deux. Deux résolutions divergeraient un jour.
        setFavorites(
          catalog.flatMap((p) => p.models.filter((m) => m.favorite).map((m) => m.id)),
        );
      })
      .catch((e) => setFavoritesError((e as Error).message));
  }, []);
```

- [ ] **Step 2: Écrire les gestes**

```typescript
  function toggleFavorite(id: string) {
    setSavedFavorites(false);
    setFavoritesError(null);
    setFavorites((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  function saveFavorites() {
    setSavingFavorites(true);
    setFavoritesError(null);
    updateProfileFavorites(favorites)
      .then(({ profile }) => {
        // Dans le cache, jamais dans un état local — exactement ce que fait
        // `save()` juste au-dessus pour les plafonds : « Scenarios » lit le
        // même profil, et le laisser périmé la ferait afficher l'ancienne
        // version au prochain clic.
        if (data) putProfile({ ...data, profile });
        setSavedFavorites(true);
      })
      .catch((e) => setFavoritesError((e as Error).message))
      .finally(() => setSavingFavorites(false));
  }

  // La même règle que la route, pour dire ce qui cloche plutôt que d'éteindre
  // « Save » sans raison — voir `capProblem` juste au-dessus, même patron.
  const favoritesProblemText = favoritesProblem(favorites);
```

`putProfile` et `data` sont déjà en portée : le premier est importé en tête du
fichier, le second vient de `useProfile()`.

- [ ] **Step 3: Écrire la section**

Insérer, entre la section des plafonds et celle de « Last hour » :

```tsx
      {providers.length > 0 && (
        <section className="space-y-3 rounded border border-zinc-300 p-4">
          <div>
            <h2 className="text-sm font-medium">Models</h2>
            <p className="mt-1 text-sm text-zinc-600">
              What you tick here is all you will be offered — on the run page,
              in every judge menu, and in what an agent reads before writing a
              run for you. The catalogue holds{" "}
              {providers.reduce((n, p) => n + p.models.length, 0)} models; a
              menu that long is worse than a short one.
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              Runs you have already launched keep showing their own models,
              whatever you change here.
            </p>
          </div>

          {providers.map((provider) => {
            // Les favoris en tête, derrière un filet : la liste sert d'abord
            // à retrouver ce qu'on s'est choisi, et à le décocher.
            const preferred = provider.models.filter((m) => favorites.includes(m.id));
            const rest = provider.models.filter((m) => !favorites.includes(m.id));
            const row = (model: (typeof provider.models)[number]) => (
              <label
                key={model.id}
                className="flex items-center gap-2 py-0.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={favorites.includes(model.id)}
                  onChange={() => toggleFavorite(model.id)}
                />
                <span className="flex-1">
                  {model.label}
                  {model.honours_temperature ? "" : " — ignores temperature"}
                </span>
                {model.input_per_mtok !== null && model.output_per_mtok !== null && (
                  <span className="font-mono text-xs text-zinc-500">
                    in ${model.input_per_mtok.toFixed(2)} · out $
                    {model.output_per_mtok.toFixed(2)} /Mtok
                  </span>
                )}
              </label>
            );
            return (
              <div key={provider.id} className="space-y-1">
                <h3 className="eyebrow">{provider.label}</h3>
                {preferred.map(row)}
                {preferred.length > 0 && rest.length > 0 && (
                  <hr className="my-1 border-zinc-200" />
                )}
                {rest.map(row)}
              </div>
            );
          })}

          {favoritesProblemText && (
            <p className="text-sm text-red-600">{favoritesProblemText}</p>
          )}
          {favoritesError && <p className="text-sm text-red-600">{favoritesError}</p>}

          <div className="flex items-center gap-3">
            <button
              onClick={saveFavorites}
              disabled={favoritesProblemText !== null || savingFavorites}
              className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-40"
            >
              {savingFavorites ? "Saving…" : "Save"}
            </button>
            {savedFavorites && <span className="text-sm text-teal-700">Saved.</span>}
          </div>
        </section>
      )}
```

- [ ] **Step 4: Vérifier**

```bash
cd web && npx tsc --noEmit 2>&1 | head -10 && npx eslint app lib components 2>&1 | tail -5
```

Attendu : aucune erreur.

- [ ] **Step 5: Vérifier à l'écran**

Avec `scripts/dev.sh` en marche, ouvrir `http://localhost:3000/profile` : les quarante et un modèles groupés par fournisseur, les dix favoris en tête de leur groupe, les tarifs à droite, « ignores temperature » sur les sept. Décocher un favori, Save, recharger : le choix tient. Tout décocher : « Save » s'éteint et la phrase explique pourquoi.

- [ ] **Step 6: Commit**

```bash
git add web/app/profile/page.tsx
git commit -m "feat: on choisit ses modèles dans son profil"
```

---

### Task 10 : Le refus MCP

Le seul endroit où un non-favori est interdit, et non seulement caché.

**Files:**
- Create: `web/lib/mcp-favorites.ts`
- Create: `web/lib/mcp-favorites.test.mts`
- Modify: `web/app/mcp/route.ts` (quatre points d'insertion)

**Interfaces:**
- Consumes: `notFavouriteProblem` de `./favorite-models.ts`, les types `EvalRunConfig` et `ExtendRequest` de `./types`.
- Produces :
  - `configFavouritesProblem(config: EvalRunConfig, favorites: readonly string[]): string | null`
  - `extendFavouritesProblem(request: ExtendRequest, favorites: readonly string[]): string | null`

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

Créer `web/lib/mcp-favorites.test.mts` :

```typescript
// Le refus d'un modèle hors favoris, côté MCP seulement — voir mcp-favorites.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { configFavouritesProblem, extendFavouritesProblem } from "./mcp-favorites.ts";
import type { EvalRunConfig, ExtendRequest } from "./types";

const FAVOURITES = ["anthropic/claude-opus-5", "grok/grok-4.6"];

function config(models: Partial<EvalRunConfig["models"]>): EvalRunConfig {
  return {
    scenarios: [],
    models: {
      targets: ["anthropic/claude-opus-5"],
      adversary: "grok/grok-4.6",
      judge: "anthropic/claude-opus-5",
      ...models,
    },
    turns: 1,
    repetitions: 1,
    criterion: "x",
    rubric: [],
    adversary_prompt: "",
  } as unknown as EvalRunConfig;
}

test("une configuration entièrement en favoris passe", () => {
  assert.equal(configFavouritesProblem(config({}), FAVOURITES), null);
});

test("un modèle évalué hors favoris est refusé, et nommé", () => {
  const problem = configFavouritesProblem(
    config({ targets: ["anthropic/claude-opus-5", "openai/gpt-5.4"] }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-5.4"));
  assert.ok(problem?.includes("favourite"));
});

test("un adversaire hors favoris est refusé", () => {
  const problem = configFavouritesProblem(
    config({ adversary: "openai/gpt-4o" }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge hors favoris est refusé", () => {
  const problem = configFavouritesProblem(
    config({ judge: "openai/gpt-4o" }),
    FAVOURITES,
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge supplémentaire hors favoris est refusé", () => {
  const withJudge = config({});
  (withJudge as unknown as { judges: { model: string }[] }).judges = [
    { model: "openai/gpt-4o" },
  ];
  const problem = configFavouritesProblem(withJudge, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un modèle qui n'existe nulle part n'est pas refusé ici", () => {
  // `configProblem` s'en charge, avec son propre message. Deux refus pour la
  // même faute enverraient corriger un profil qui n'y peut rien.
  assert.equal(
    configFavouritesProblem(config({ judge: "openai/gpt-inconnu" }), FAVOURITES),
    null,
  );
});

test("un adversaire absent ne pose pas de problème", () => {
  assert.equal(
    configFavouritesProblem(config({ adversary: null }), FAVOURITES),
    null,
  );
});

test("une extension aux cibles en favoris passe", () => {
  const request = { targets: ["grok/grok-4.6"] } as unknown as ExtendRequest;
  assert.equal(extendFavouritesProblem(request, FAVOURITES), null);
});

test("une extension qui ajoute une colonne hors favoris est refusée", () => {
  const request = { targets: ["openai/gpt-4o"] } as unknown as ExtendRequest;
  const problem = extendFavouritesProblem(request, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge ajouté par extension hors favoris est refusé", () => {
  const request = {
    targets: [],
    new_judges: [{ model: "openai/gpt-4o" }],
  } as unknown as ExtendRequest;
  const problem = extendFavouritesProblem(request, FAVOURITES);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("un juge ajouté sans modèle reprend celui du run, et passe", () => {
  const request = {
    targets: [],
    new_judges: [{ criterion: "x" }],
  } as unknown as ExtendRequest;
  assert.equal(extendFavouritesProblem(request, FAVOURITES), null);
});

test("configProblem, lui, ne connaît pas les favoris", () => {
  // La frontière du chantier, tenue par un test plutôt que par la bonne
  // volonté : le jour où quelqu'un câblera les favoris dans `validate.ts`,
  // une relance humaine d'un vieux run cesserait de partir, et c'est ici
  // qu'on l'apprendra plutôt qu'en production.
  const outsideButReal = config({ judge: "openai/gpt-4o" });
  assert.equal(configProblem(outsideButReal), null);
  assert.notEqual(configFavouritesProblem(outsideButReal, FAVOURITES), null);
});
```

L'import en tête du fichier devient :

```typescript
import { configFavouritesProblem, extendFavouritesProblem } from "./mcp-favorites.ts";
import { configProblem } from "./validate.ts";
```

Si `configProblem` refuse cette configuration pour une autre raison que le modèle (un scénario manquant, une échelle vide), étoffer le fabricant `config()` ci-dessus jusqu'à ce qu'elle passe — c'est le modèle qu'on teste, pas le reste de la validation.

- [ ] **Step 2: Le lancer pour le voir échouer**

```bash
cd web && npm test 2>&1 | tail -20
```

Attendu : échec — `./mcp-favorites.ts` n'existe pas.

- [ ] **Step 3: Écrire le module**

Créer `web/lib/mcp-favorites.ts` :

```typescript
// Le refus d'un modèle hors favoris — et cet endroit est le seul.
//
// `configProblem` continue de valider contre le catalogue ENTIER, et c'est
// voulu : un run déjà lancé doit s'afficher avec ses modèles, et une relance
// pré-remplie doit rester lançable à la main. C'est l'agent qu'on borne, pas
// la personne.
//
// D'où ce module à part plutôt qu'une branche dans `validate.ts` : le jour où
// quelqu'un ajoutera un appelant à `configProblem`, il n'héritera pas d'un
// refus qui n'a de sens que par MCP.
import { notFavouriteProblem } from "./favorite-models.ts";
import type { EvalRunConfig, ExtendRequest } from "./types";

/** Le premier modèle hors favoris d'une liste, formulé, ou `null`.
 *
 * Le premier et non tous : le message dit quoi faire, et une énumération de
 * cinq refus n'aide pas plus qu'un seul à retrouver son profil. */
function firstProblem(
  entries: { id: string | null | undefined; where: string }[],
  favorites: readonly string[],
): string | null {
  for (const entry of entries) {
    const problem = notFavouriteProblem(entry.id ?? "", favorites, entry.where);
    if (problem) return problem;
  }
  return null;
}

/** Ce qui, dans les modèles d'un run, n'est pas dans les favoris de
 *  l'appelant — ou `null`. */
export function configFavouritesProblem(
  config: EvalRunConfig,
  favorites: readonly string[],
): string | null {
  return firstProblem(
    [
      ...config.models.targets.map((id, index) => ({
        id,
        where: `models.targets[${index}]`,
      })),
      { id: config.models.adversary, where: "models.adversary" },
      { id: config.models.judge, where: "models.judge" },
      ...(config.judges ?? []).map((judge, index) => ({
        id: judge.model,
        where: `judges[${index}].model`,
      })),
    ],
    favorites,
  );
}

/** Ce qui, dans les modèles qu'une extension ajoute, n'est pas dans les
 *  favoris de l'appelant — ou `null`.
 *
 * Ne regarde que ce que l'extension AJOUTE. Les colonnes déjà jouées du run
 * ne sont pas rejugées ici : elles ont été lancées, elles existent, et les
 * refuser rétroactivement empêcherait d'approfondir un run dont un modèle a
 * quitté les favoris entre-temps. */
export function extendFavouritesProblem(
  request: ExtendRequest,
  favorites: readonly string[],
): string | null {
  return firstProblem(
    [
      ...(request.targets ?? []).map((id, index) => ({
        id,
        where: `targets[${index}]`,
      })),
      ...(request.new_judges ?? []).map((judge, index) => ({
        // Un juge sans modèle reprend celui du run, qui est déjà lancé :
        // rien à vérifier, `notFavouriteProblem` laisse passer la chaîne vide.
        id: judge.model,
        where: `new_judges[${index}].model`,
      })),
    ],
    favorites,
  );
}
```

- [ ] **Step 4: Lancer les tests**

```bash
cd web && npm test 2>&1 | tail -10
```

Attendu : les onze tests de `mcp-favorites.test.mts` passent.

- [ ] **Step 5: Brancher les quatre points d'insertion**

Dans `web/app/mcp/route.ts`, ajouter l'import :

```typescript
import { configFavouritesProblem, extendFavouritesProblem } from "@/lib/mcp-favorites";
```

**(a) `submit_draft_run`** — après `const caller = await callerEmail(ctx);` et **avant** `createDraft`, insérer :

```typescript
      // Le seul endroit où un modèle hors favoris est interdit et non
      // seulement caché : `read_prompt` ne lui en a pas parlé, et le refuser
      // au dépôt lui épargne un brouillon qu'il ne pourrait pas lancer.
      const outside = configFavouritesProblem(
        config,
        favoriteModels(await profileOf(caller)),
      );
      if (outside) return toolError(outside);
```

**(b) `launch_draft`, branche « run »** — juste après `const problem = configProblem(draft.config); if (problem) return toolError(problem);`, insérer :

```typescript
      // Revérifié au lancement comme `configProblem` juste au-dessus, et pour
      // la même raison : le brouillon était bon au dépôt, mais les favoris
      // ont pu changer depuis.
      const outside = configFavouritesProblem(
        draft.config,
        favoriteModels(await profileOf(caller)),
      );
      if (outside) return toolError(outside);
```

**(c) `launch_draft`, branche « extend »** — juste après le `if (problem) return toolError(problem);` qui suit `extendProblem`, insérer :

```typescript
        const outside = extendFavouritesProblem(
          request,
          favoriteModels(await profileOf(caller)),
        );
        if (outside) return toolError(outside);
```

**(d) `submit_draft_extension`** — juste après le bloc `if (problem) { return { content: [{ type: "text", text: problem }], isError: true }; }`, insérer :

```typescript
      const outside = extendFavouritesProblem(
        request,
        favoriteModels(await profileOf(caller)),
      );
      if (outside) return toolError(outside);
```

Vérifier qu'`import { favoriteModels } from "@/lib/favorite-models";` est bien présent (posé à la Task 7).

- [ ] **Step 6: Vérifier la compilation**

```bash
cd web && npx tsc --noEmit 2>&1 | head -10 && npx eslint app lib components 2>&1 | tail -5
```

Attendu : aucune erreur. Si un `const outside` entre en collision avec un identifiant du même bloc, le renommer localement (`outsideFavourites`).

- [ ] **Step 7: Vérifier le refus pour de vrai**

Avec `scripts/dev.sh` en marche et le connecteur MCP local, demander à un agent de déposer un run avec `models.judge: openai/gpt-4o`. Attendu : un refus portant « exists, but it is not in your favourite models ».

À défaut de connecteur, vérifier par la fonction :

```bash
cd web && node --input-type=module -e "
import { configFavouritesProblem } from './lib/mcp-favorites.ts';
console.log(configFavouritesProblem(
  { models: { targets: ['openai/gpt-4o'], adversary: null, judge: 'grok/grok-4.6' } },
  ['grok/grok-4.6']));
"
```

Attendu : le message de refus, nommant `openai/gpt-4o`.

- [ ] **Step 8: Commit**

```bash
git add web/lib/mcp-favorites.ts web/lib/mcp-favorites.test.mts web/app/mcp/route.ts
git commit -m "feat: MCP refuse un modèle hors favoris, et dit comment le reprendre"
```

---

### Task 11 : Ce que la documentation doit dire

**Files:**
- Modify: `.env.example`
- Modify: `docs/DEPLOY.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: rien.
- Produces: rien de code.

- [ ] **Step 1: Ajouter la clé à `.env.example`**

Après le bloc xAI, insérer :

```
# Google / Gemini — https://aistudio.google.com/apikey
# Note: GOOGLE_API_KEY est aussi accepté ; inspect_ai lit les deux.
GEMINI_API_KEY=
```

- [ ] **Step 2: Dire le nouveau secret dans `docs/DEPLOY.md`**

Dans la section « Le moteur — Cloud Run Job », après la phrase sur `polaris-tf`, ajouter :

```markdown
Quatre clés de fournisseur y sont montées : `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `XAI_API_KEY` et `GEMINI_API_KEY`. La dernière est arrivée
avec le catalogue élargi ; comme les autres, `polaris-tf` crée le conteneur et
jamais la valeur — et le piège rappelé plus bas s'applique à elle en premier.
```

Ne rien changer au paragraphe « **Aucune clé de fournisseur.** » de la section Vercel : il reste vrai, et c'est lui qui a écarté les boutons de test.

- [ ] **Step 3: Dire les favoris dans `CLAUDE.md`**

Dans `CLAUDE.md`, à la fin de la section « Où vivent les données », ajouter :

```markdown
La table `profiles` porte aussi les **favoris de modèles** : `favorite_models`,
`NULL` valant « le défaut du code » (`web/lib/favorite-models.ts`). Ils décident
de tout ce qui *propose* — écrans, prompt de l'agent, outils MCP — et de rien
de ce qui *existe* : `configProblem` valide contre le catalogue entier, pour
qu'un run déjà lancé s'affiche et qu'une relance humaine reste lançable. Seuls
les outils MCP refusent un modèle hors favoris.
```

- [ ] **Step 4: Commit**

```bash
git add .env.example docs/DEPLOY.md CLAUDE.md
git commit -m "docs: la clé Gemini, et ce que les favoris bornent"
```

---

### Task 12 : Terraform — le secret Gemini

Dans **le dépôt `polaris-tf`**, jamais appliqué depuis ici.

**Files:**
- Modify: `/Users/sverbo/Desktop/Codes/Polaris/polaris-tf/environments/app/secrets.tf`
- Modify: `/Users/sverbo/Desktop/Codes/Polaris/polaris-tf/environments/app/evals_playground_batch.tf`

**Interfaces:**
- Consumes: rien.
- Produces: le secret `GEMINI_API_KEY` et son montage dans le job.

- [ ] **Step 1: Déclarer le secret**

Dans `environments/app/secrets.tf`, juste après le bloc `google_secret_manager_secret.xai_api_key` (qui se termine vers la ligne 232), ajouter :

```hcl
resource "google_secret_manager_secret" "gemini_api_key" {
  project   = var.project_id
  secret_id = "GEMINI_API_KEY"
  labels    = { service = "evals-playground-runner" }
  replication {
    auto {}
  }
  depends_on = [module.app_apis]
  # No initial value — set manually: gcloud secrets versions add GEMINI_API_KEY --data-file=- --project=PROJECT_ID
}
```

Corriger aussi le commentaire de tête de la section, qui dit « all three provider keys » et en compte désormais quatre :

```hcl
# --- evals-playground batch execution ---

# This product compares models across vendors in one run, so its runner needs
# all four provider keys — not just Anthropic like cop-batch-runner.
```

- [ ] **Step 2: Monter le secret dans le job**

Dans `environments/app/evals_playground_batch.tf`, juste après le bloc `env` de `XAI_API_KEY` (qui se termine vers la ligne 75), ajouter :

```hcl
        env {
          name = "GEMINI_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.gemini_api_key.secret_id
              version = "latest"
            }
          }
        }
```

Corriger là aussi le commentaire juste au-dessus du premier `env` :

```hcl
        # All four providers, unlike cop-batch-runner: this product's whole
        # point is comparing models across vendors in one run.
```

- [ ] **Step 3: Poser la valeur AVANT tout apply**

**Cet ordre n'est pas négociable** : Cloud Run refuse de créer un conteneur qui monte un secret sans version, et `polaris-tf` ne gère jamais les valeurs. C'est écrit en tête d'`evals_playground_batch.tf`, et ça a déjà coûté un apply raté.

À faire par une personne, avec le compte qui en a le droit :

```bash
gcloud auth login admin@polariscollective.org
echo -n "<la clé Gemini>" | gcloud secrets versions add GEMINI_API_KEY \
  --data-file=- --project=polaris-dev-499211
echo -n "<la clé Gemini>" | gcloud secrets versions add GEMINI_API_KEY \
  --data-file=- --project=polaris-prod-499213
```

Le secret doit d'abord exister : sur un projet neuf, `terraform apply` crée le conteneur, mais le job ne démarrera pas tant que la version n'est pas posée. Créer le conteneur seul si besoin :

```bash
gcloud secrets create GEMINI_API_KEY --replication-policy=automatic --project=polaris-dev-499211
```

- [ ] **Step 4: Vérifier le plan localement (facultatif)**

La PR déclenche déjà le plan sur dev **et** prod — c'est le chemin normal, et il suffit. Pour le voir avant de pousser :

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-tf/environments/app
terraform init -backend-config="prefix=dev"
terraform plan -var-file=terraform.tfvars.dev
```

Attendu : deux créations — `google_secret_manager_secret.gemini_api_key` et la mise à jour du job qui monte l'`env`. **Aucune destruction.** Si le plan propose de détruire un secret, s'arrêter : un secret détruit emporte ses versions, et un service vivant en dépend.

- [ ] **Step 5: Commit et PR**

```bash
cd /Users/sverbo/Desktop/Codes/Polaris/polaris-tf
git checkout -b feat/gemini-api-key
git add environments/app/secrets.tf environments/app/evals_playground_batch.tf
git commit -m "feat: le secret GEMINI_API_KEY, monté dans le job evals-playground"
git push -u origin feat/gemini-api-key
gh pr create --base develop --title "Le secret GEMINI_API_KEY pour evals-playground" \
  --body "Le catalogue d'evals-playground accueille Gemini. Le job a besoin de la clé.

La valeur doit être posée AVANT l'apply : Cloud Run refuse un conteneur qui monte un secret sans version."
```

L'apply se fait par la CI de `polaris-tf` sur `develop` (dev) puis `main` (prod, avec approbation). Rien n'est appliqué depuis ce chantier.

---

### Task 13 : Le tour complet, sur la vraie base

**Files:** aucun.

- [ ] **Step 1: Lancer toutes les suites**

```bash
.venv/bin/python -m pytest -q
cd web && npm test && npx tsc --noEmit && npx eslint app lib components
```

Attendu : `392 passed` côté Python (plus les nouveaux tests de `test_catalog.py`), tout vert côté web, zéro erreur de type, zéro avertissement de lint.

- [ ] **Step 2: Un vrai run, deux cases, un modèle Google**

Avec `scripts/dev.sh` en marche : sur `/profile`, cocher `google/gemini-3.8-flash` et sauver. Sur la page de run, composer un scénario, deux modèles évalués dont le Gemini, une répétition, un tour, un juge. Lancer.

Attendu : les deux cases se remplissent, le Gemini répond, le coût s'affiche pour les deux modèles.

- [ ] **Step 3: Vérifier le devis de bout en bout**

Sur la même page, avant de lancer, comparer le devis affiché au calcul à la main pour un modèle : `(jetons_entrée / 1e6) × input_per_mtok + (jetons_sortie / 1e6) × output_per_mtok`. Attendu : le même chiffre — et pour `claude-sonnet-5`, il doit reposer sur 2/10 et non 3/15.

- [ ] **Step 4: Commit final s'il reste quelque chose**

```bash
git status
```

Attendu : rien à commiter. Sinon, commiter le reste avec un message qui dit quoi.

---

## Ce que ce plan ne fait pas

- **Aucun bouton de test** dans le produit — écarté avec la personne qui l'avait demandé : il aurait fallu soit des clés de fournisseur sur Vercel, que `docs/DEPLOY.md` interdit, soit un aller-retour par le Cloud Run Job pour répondre « oui ».
- **Aucun filtrage à l'affichage d'un run passé.**
- **Aucun changement au moteur Python** hors dépendances et champ de catalogue : `known_model_ids()` reste le catalogue entier, parce que le job exécute ce que le run dit, pas ce que les favoris d'aujourd'hui disent.
- **Aucun apply Terraform.**
