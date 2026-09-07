# Le modèle du monde — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Le modèle qui sert les outils non déterministes cesse d'être écrit en dur : chaque run le nomme, parmi ses favoris, et il est requis exactement quand un outil est servi.

**Architecture:** `models.world` rejoint `EvalModels` avec la même forme qu'`adversary` — un modèle rendu obligatoire par une condition ailleurs dans la configuration. Un prédicat unique, `servesTools`, porte les deux refus symétriques du lancement et les trois cas de l'extension. Le contrôleur du monde suit automatiquement, d'un autre fournisseur que le serveur, et son échec cesse d'être silencieux.

**Tech Stack:** Next.js 16 + TypeScript, Python 3.12 + `inspect_ai`, Supabase (PostgREST), `node:test` et `pytest`.

## Global Constraints

- Spec de référence : `docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md`. En cas de contradiction, le spec fait foi.
- Les migrations SQL vivent dans `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/`, jamais dans ce dépôt.
- **Favoris** : `models.world` est un modèle comme les autres — il entre dans `configFavouritesProblem` et `extendFavouritesProblem`. Les favoris bornent ce qui est *proposé*, jamais ce qui *existe* : `configProblem` reste aveugle aux favoris.
- **Un refus arrête, un avertissement informe.** Les avertissements ne passent jamais par `validate.ts`, qui ne rend que des refus.
- Les commentaires du code sont en français et disent *pourquoi* ; les textes vus par un humain ou un agent sont en anglais.
- Tests, et l'état de départ mesuré sur `main` :

  | commande | où | départ |
  |---|---|---|
  | `.venv/bin/python -m pytest -q` | racine | `438 passed` |
  | `npm test` | `web/` | `611 pass` |
  | `npx tsc --noEmit` | `web/` | propre |
  | `npx eslint app lib components` | `web/` | propre |

- **`npm run lint` sans argument ne sert à rien** : il balaie `web/public/inspect-view`, un bundle vendu, et rend des milliers de problèmes hérités. Cadrer sur les sources.
- **`npx tsc --noEmit` a besoin d'un `npx next typegen` une fois** dans un worktree neuf, sans quoi il rend `Cannot find name 'LayoutProps'`.

---

## Structure des fichiers

**Créés**

| fichier | responsabilité |
|---|---|
| `web/lib/world-warnings.ts` | les avertissements « servi depuis un monde vide » — informe, ne refuse pas |
| `web/lib/world-warnings.test.mts` | ses tests |
| `web/lib/check-model.ts` | le choix du contrôleur, d'un autre fournisseur que le serveur |
| `web/lib/check-model.test.mts` | ses tests |
| `polaris-supabase/…/20260907190000_tool_results_check_error.sql` | la colonne |

**Modifiés** — `web/lib/tools.ts`, `web/lib/types.ts`, `web/lib/validate.ts`, `web/lib/pricing.ts`, `web/lib/config-file.ts`, `web/lib/mcp-favorites.ts`, `web/lib/agent-prompt.ts`, `web/app/mcp/route.ts`, `web/app/page.tsx`, `web/components/ExtendPanel.tsx`, `web/components/RunRead.tsx`, `shared/world-prompt.json`, `backend/playground/eval_schemas.py`, `backend/playground/world.py`, `backend/playground/pricing.py`, `backend/playground/batch_job.py`, `backend/playground/supabase_store.py`.

---

### Task 1 : Le prédicat `served`, côté TypeScript

Le Python a déjà `ToolSpec.served`, dont la docstring dit pourquoi il ne doit vivre qu'à un endroit : « Le recopier sur chaque site d'appel, c'est l'oublier sur le troisième. » Le TypeScript n'a pas son jumeau, et trois tâches d'après en ont besoin.

**Files:**
- Modify: `web/lib/tools.ts`
- Test: `web/lib/tools.test.mts` (créer s'il n'existe pas)

**Interfaces:**
- Produces : `served(tool: Pick<ToolSpec, "retrieval_rules">): boolean` et `servesTools(tools: readonly Pick<ToolSpec, "retrieval_rules">[]): boolean`.

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

```typescript
test("un outil sans règles de lecture est fixe", () => {
  assert.equal(served({ retrieval_rules: undefined }), false);
  assert.equal(served({ retrieval_rules: "" }), false);
  // Des blancs ne sont pas des règles : un champ effacé à moitié dans un
  // formulaire ne doit pas faire basculer l'outil en servi, et donc payer.
  assert.equal(served({ retrieval_rules: "   \n  " }), false);
});

test("un outil avec des règles de lecture est servi", () => {
  assert.equal(served({ retrieval_rules: "Return at most twenty lines." }), true);
});

test("un run sert dès qu'un seul de ses outils sert", () => {
  assert.equal(servesTools([]), false);
  assert.equal(servesTools([{ retrieval_rules: "" }]), false);
  assert.equal(
    servesTools([{ retrieval_rules: "" }, { retrieval_rules: "rules" }]),
    true,
  );
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

Run: `npm test` depuis `web/`. Attendu : échec — `served` n'est pas exporté.

- [ ] **Step 3: Écrire le prédicat**

Dans `web/lib/tools.ts` :

```typescript
/** Cet outil passe-t-il par le modèle d'environnement ?
 *
 * Jumeau de `ToolSpec.served` côté Python, et pour la même raison : le
 * discriminant vit à un endroit, sans quoi on l'oublie au troisième site
 * d'appel. Détouré parce qu'un champ à moitié effacé dans un formulaire ne
 * doit pas faire basculer un outil en servi — donc payant. */
export function served(tool: Pick<ToolSpec, "retrieval_rules">): boolean {
  return Boolean(tool.retrieval_rules?.trim());
}

/** Ce run sert-il au moins un outil ?
 *
 * La question que posent les deux refus de `models.world` : requis dès qu'un
 * outil sert, interdit sinon. */
export function servesTools(
  tools: readonly Pick<ToolSpec, "retrieval_rules">[],
): boolean {
  return tools.some(served);
}
```

- [ ] **Step 4: Lancer les tests**

Run: `npm test` depuis `web/`. Attendu : les trois passent, total 614.

- [ ] **Step 5: Commit**

```bash
git add web/lib/tools.ts web/lib/tools.test.mts
git commit -m "feat: le discriminant « servi » a son jumeau TypeScript"
```

---

### Task 2 : `models.world` et son équivalence

**Files:**
- Modify: `web/lib/types.ts` (`EvalModels`), `web/lib/validate.ts` (`configProblem`), `web/lib/config-file.ts`, `backend/playground/eval_schemas.py` (`EvalModels`)
- Test: `web/lib/validate.test.mts`

**Interfaces:**
- Consumes : `servesTools` (Task 1).
- Produces : `EvalModels.world?: string | null` (TS) et `world: str | None = None` (Python).

- [ ] **Step 1: Écrire les tests du refus, qui doivent échouer**

Dans `web/lib/validate.test.mts`, sur le patron des tests existants de `configProblem` :

```typescript
test("un outil servi sans models.world est refusé", () => {
  const config = configAvecOutilServi();   // helper local, voir plus bas
  delete (config.models as { world?: string }).world;
  const problem = configProblem(config);
  assert.ok(problem?.includes("models.world"));
});

test("models.world sans outil servi est refusé", () => {
  // Un réglage qui existe sans effet est ce qu'on relit six mois plus tard en
  // se demandant s'il a compté.
  const config = configSansOutilServi();
  (config.models as { world?: string }).world = "openai/gpt-5.6-luna";
  assert.ok(configProblem(config)?.includes("models.world"));
});

test("un outil servi avec models.world passe", () => {
  assert.equal(configProblem(configAvecOutilServi()), null);
});

test("aucun outil servi et pas de models.world passe", () => {
  assert.equal(configProblem(configSansOutilServi()), null);
});
```

Écrire les deux fabricants locaux dans le même fichier, en partant d'une configuration déjà valide selon les tests voisins : `configAvecOutilServi()` porte un outil `{ name, description, parameters: [], retrieval_rules: "Return at most twenty lines." }`, un `world` non vide, et `models.world: "openai/gpt-5.6-luna"` ; `configSansOutilServi()` porte le même outil avec `result: "412 records deleted."` à la place des règles, aucun `world`, et pas de `models.world`.

- [ ] **Step 2: Le lancer pour le voir échouer**

Run: `npm test` depuis `web/`. Attendu : les deux premiers échouent — aucun refus n'existe.

- [ ] **Step 3: Étendre les deux schémas**

Dans `web/lib/types.ts`, `EvalModels` :

```typescript
  /** Le modèle qui sert les outils portant des règles de lecture.
   *
   * Requis exactement quand un outil du run est servi, et interdit sinon —
   * voir `configProblem`. Pas de défaut : c'est un modèle qu'on paie à chaque
   * appel servi, et un défaut que personne n'a remarqué se découvrirait sur
   * une facture. Il était écrit en dur avant ce chantier ; ce qui a motivé le
   * changement, et ce qui reste protégé, sont dans le spec du 7 septembre. */
  world?: string | null;
```

Dans `backend/playground/eval_schemas.py`, `EvalModels`, avec la même docstring en français.

- [ ] **Step 4: Écrire le refus**

Dans `web/lib/validate.ts`, à l'intérieur de `configProblem`, après les refus de modèles existants :

```typescript
  // L'équivalence, dans les deux sens. Servir sans modèle ne répondrait à
  // rien ; nommer un modèle sans rien à servir est un réglage sans effet, et
  // un réglage sans effet est pire qu'absent — on le relit plus tard en se
  // demandant s'il a compté.
  const sert = servesTools(c.tools ?? []);
  const monde = isFilled(c.models?.world);
  if (sert && !monde) {
    return (
      "models.world: this run serves at least one tool, so it needs a model to " +
      "answer those calls. Pick one from the models listed in /prompt."
    );
  }
  if (!sert && monde) {
    return (
      "models.world: no tool in this run has retrieval_rules, so nothing is " +
      "served and this model would never be called. Remove it, or give a tool " +
      "reading rules."
    );
  }
```

Ajouter `import { servesTools } from "./tools.ts";` en tête.

- [ ] **Step 5: Faire suivre `config-file.ts`**

Vérifier que `readConfigFile` transporte `models.world` — le fichier lit déjà `models` champ par champ. Ajouter la lecture sur le patron d'`adversary`.

- [ ] **Step 6: Lancer les deux suites**

Run: `npm test` depuis `web/`, puis `.venv/bin/python -m pytest -q` depuis la racine.
Attendu : tout passe. Des tests Python portant sur des configurations à outils servis peuvent échouer faute de `models.world` — c'est le refus qui fonctionne ; leur ajouter le champ.

- [ ] **Step 7: Commit**

```bash
git add web/lib/types.ts web/lib/validate.ts web/lib/validate.test.mts web/lib/config-file.ts backend/playground/eval_schemas.py
git commit -m "feat: un run qui sert ses outils nomme le modèle qui les sert"
```

---

### Task 3 : Les devis chiffrent le modèle nommé, et la constante disparaît

**Files:**
- Modify: `shared/world-prompt.json`, `backend/playground/world.py`, `backend/playground/pricing.py`, `backend/playground/batch_job.py`, `web/lib/pricing.ts`
- Test: `tests/test_pricing.py`, `web/lib/pricing.test.mts`

**Interfaces:**
- Consumes : `EvalModels.world` (Task 2).
- Produces : plus aucun `WORLD_MODEL` ; `serve()` reçoit le modèle du run.

- [ ] **Step 1: Écrire le test du devis, qui doit échouer**

Dans `web/lib/pricing.test.mts` :

```typescript
test("les appels servis sont chiffrés au modèle que le run nomme", () => {
  // Chiffrer une constante annoncerait le prix d'un modèle qui ne tournera
  // pas — le devis mentirait sans que rien ne le montre.
  const config = configAvecOutilServi();
  config.models.world = "anthropic/claude-haiku-4-5";
  const estimate = estimateCost(config);
  const modèles = estimate.costs.map((c) => c.model);
  assert.ok(modèles.includes("anthropic/claude-haiku-4-5"));
  assert.ok(!modèles.includes("openai/gpt-5.6-luna"));
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

Run: `npm test` depuis `web/`. Attendu : échec — le devis nomme toujours la constante.

- [ ] **Step 3: Retirer la clé du fichier partagé**

Dans `shared/world-prompt.json`, supprimer la clé `"model"`. Ne pas toucher à `check_model` (Task 5 s'en occupe).

- [ ] **Step 4: Supprimer `WORLD_MODEL` et faire descendre le modèle**

Dans `backend/playground/world.py`, supprimer la constante `WORLD_MODEL` et sa docstring.

Dans `backend/playground/batch_job.py` : l'appel `get_model(WORLD_MODEL, …)` devient `get_model(config.models.world, …)`, et le `model=WORLD_MODEL` passé à `write_tool_result` devient `model=config.models.world`. Retirer `WORLD_MODEL` de l'import.

Dans `backend/playground/pricing.py` : `_add(per_model, WORLD_MODEL, …)` devient `_add(per_model, config.models.world, …)`. Retirer l'import.

Dans `web/lib/pricing.ts` : `add(M.model, …)` devient `add(config.models.world ?? "", …)`. Le `?? ""` n'est pas un défaut caché — à ce point du calcul, `servis.length > 0`, donc `configProblem` a déjà exigé le champ ; il ne sert qu'à satisfaire le typage. L'écrire en commentaire.

- [ ] **Step 5: Lancer les deux suites**

Run: `npm test` depuis `web/`, puis `.venv/bin/python -m pytest -q`. Attendu : tout passe.

- [ ] **Step 6: Commit**

```bash
git add shared/world-prompt.json backend/playground/world.py backend/playground/batch_job.py backend/playground/pricing.py web/lib/pricing.ts web/lib/pricing.test.mts
git commit -m "feat: le modèle du monde vient du run, plus d'une constante"
```

---

### Task 4 : L'extension, trois cas

**Files:**
- Modify: `web/lib/types.ts` (`ExtendRequest`), `web/lib/validate.ts` (`extendProblem`), `backend/playground/eval_schemas.py`
- Test: `web/lib/extend.test.mts`

**Interfaces:**
- Consumes : `servesTools` (Task 1), `EvalModels.world` (Task 2).
- Produces : `ExtendRequest.world?: string | null` ; `extendProblem` gagne le paramètre `runWorldModel: string | null` en dernière position.

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

```typescript
test("un run sans modèle de monde, une extension qui sert : world requis", () => {
  const request = { targets: [], repetitions: 0, scenario_indices: [], new_scenarios: [],
    new_tools: [{ name: "search", description: "d", parameters: [], retrieval_rules: "r" }] };
  const problem = extendProblem(request, 1, [], 1, null, [0, 1], null);
  assert.ok(problem?.includes("world"));
});

test("un run sans modèle, une extension qui ne sert rien : nommer world est refusé", () => {
  const request = { targets: [], repetitions: 0, scenario_indices: [0], new_scenarios: [],
    world: "openai/gpt-5.6-luna" };
  assert.ok(extendProblem(request, 1, [], 1, null, [0, 1], null)?.includes("world"));
});

test("un run qui a déjà un modèle : le même passe, un autre est refusé", () => {
  const base = { targets: [], repetitions: 0, scenario_indices: [0], new_scenarios: [] };
  assert.equal(
    extendProblem({ ...base, world: "openai/gpt-5.6-luna" }, 1, [], 1, null, [0, 1],
      "openai/gpt-5.6-luna"),
    null,
  );
  const problem = extendProblem({ ...base, world: "grok/grok-4.6" }, 1, [], 1, null, [0, 1],
    "openai/gpt-5.6-luna");
  assert.ok(problem?.includes("incomparable"));
});

test("un run qui a déjà un modèle : ne rien nommer passe, c'est hérité", () => {
  const request = { targets: [], repetitions: 0, scenario_indices: [0], new_scenarios: [] };
  assert.equal(extendProblem(request, 1, [], 1, null, [0, 1], "openai/gpt-5.6-luna"), null);
});
```

Adapter la signature exacte d'`extendProblem` à celle du dépôt : lire ses appels dans `web/app/api/runs/[runId]/extend/route.ts` et `web/app/mcp/route.ts`, et **ajouter le nouveau paramètre en dernier** pour ne pas déplacer les existants.

- [ ] **Step 2: Le lancer pour le voir échouer**

Run: `npm test` depuis `web/`.

- [ ] **Step 3: Écrire les trois refus**

Dans `extendProblem`, après les refus existants :

```typescript
  // Trois cas, et le troisième est le seul qui surprenne : un run qui sert
  // déjà impose son modèle. Deux serveurs dans un même run rendraient ses
  // cases incomparables, et c'est la seule chose qu'une matrice ne survit pas.
  const ajouteDuServi = servesTools(request.new_tools ?? []);
  const nommé = isFilled(request.world);
  if (runWorldModel) {
    if (nommé && request.world !== runWorldModel) {
      return (
        `world: this run already serves its tools with "${runWorldModel}". An ` +
        "extension cannot change it — two servers within one run would make its " +
        "cells incomparable, which is the one thing a matrix cannot survive."
      );
    }
  } else if (ajouteDuServi) {
    if (!nommé) {
      return (
        "world: this extension adds a tool with retrieval_rules to a run that " +
        "serves none yet, so it needs a model to answer those calls."
      );
    }
  } else if (nommé) {
    return (
      "world: this extension adds no served tool and the run serves none, so " +
      "this model would never be called."
    );
  }
```

Le miroir Python dans `eval_schemas.py` si un validateur d'extension y existe ; sinon rien.

- [ ] **Step 4: Faire passer le modèle du run aux deux appelants**

`web/app/api/runs/[runId]/extend/route.ts` et le site MCP passent `run.config.models.world ?? null` en dernier argument.

- [ ] **Step 5: Lancer les suites, puis commit**

```bash
git add web/lib/types.ts web/lib/validate.ts web/lib/extend.test.mts backend/playground/eval_schemas.py "web/app/api/runs/[runId]/extend/route.ts" web/app/mcp/route.ts
git commit -m "feat: une extension hérite du serveur du run, et ne peut pas en changer"
```

---

### Task 5 : Le contrôleur se choisit d'un autre fournisseur

**Files:**
- Create: `web/lib/check-model.ts`, `web/lib/check-model.test.mts`
- Modify: `shared/world-prompt.json`, `backend/playground/world.py`, `backend/playground/batch_job.py`
- Test: `tests/test_world.py`

**Interfaces:**
- Produces : `checkModelFor(worldModel: string, candidates: readonly string[]): string` (TS) et `check_model_for(world_model: str) -> str` (Python).

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

```typescript
const CANDIDATS = ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna"];

test("le contrôleur est d'un autre fournisseur que le serveur", () => {
  assert.equal(checkModelFor("openai/gpt-5.6-luna", CANDIDATS), "anthropic/claude-haiku-4-5");
  assert.equal(checkModelFor("anthropic/claude-haiku-4-5", CANDIDATS), "openai/gpt-5.6-luna");
  assert.equal(checkModelFor("grok/grok-4.3", CANDIDATS), "anthropic/claude-haiku-4-5");
});

test("la liste livrée couvre au moins deux fournisseurs", () => {
  // Sans ça, un serveur de la famille de l'unique candidat se ferait
  // contrôler par lui-même, et le contrôle validerait ses propres erreurs.
  const fournisseurs = new Set(
    (SHARED_WORLD_PROMPT.check_models as string[]).map((id) => id.split("/")[0]),
  );
  assert.ok(fournisseurs.size >= 2);
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

- [ ] **Step 3: Écrire le module et retourner le fichier partagé**

`shared/world-prompt.json` : `"check_model": "anthropic/claude-haiku-4-5"` devient
`"check_models": ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-luna"]`.

`web/lib/check-model.ts` :

```typescript
/** Le contrôleur d'un run servi : le premier candidat d'un autre fournisseur
 *  que le serveur.
 *
 * Toute la valeur du contrôle tient à ce qu'il ne partage pas les travers du
 * serveur : un contrôleur de la même famille trouve ses inventions
 * plausibles, parce qu'il les aurait faites aussi. Le serveur devenant
 * choisissable, un contrôleur fixe deviendrait creux sans le dire.
 *
 * Aucun candidat d'un autre fournisseur est une faute du fichier partagé, pas
 * un cas d'exécution — un test exige que la liste en couvre deux. Le repli sur
 * le premier existe pour ne jamais rendre `undefined` à l'appelant. */
export function checkModelFor(
  worldModel: string,
  candidates: readonly string[],
): string {
  const fournisseur = worldModel.split("/")[0];
  return (
    candidates.find((id) => id.split("/")[0] !== fournisseur) ?? candidates[0]
  );
}
```

Le jumeau Python dans `backend/playground/world.py` : `CHECK_MODEL` disparaît, remplacé par `CHECK_MODELS: list[str] = _SHARED["check_models"]` et `check_model_for(world_model)`.

`backend/playground/batch_job.py` : `get_model(CHECK_MODEL, …)` devient `get_model(check_model_for(config.models.world), …)`.

- [ ] **Step 4: Lancer les suites, puis commit**

```bash
git add shared/world-prompt.json web/lib/check-model.ts web/lib/check-model.test.mts backend/playground/world.py backend/playground/batch_job.py tests/test_world.py
git commit -m "feat: le contrôleur du monde se choisit d'une autre famille que le serveur"
```

---

### Task 6 : L'échec du contrôle cesse d'être muet

**Files:**
- Create: `/Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals/supabase/migrations/20260907190000_tool_results_check_error.sql`
- Modify: `backend/playground/supabase_store.py`, `backend/playground/batch_job.py`

**Interfaces:**
- Produces : colonne `tool_results.check_error text`, et `write_tool_check_error(supabase, run_id, scenario_index, tool_name, arguments_hash, *, reason: str)`.

- [ ] **Step 1: Écrire la migration**

Dans **le dépôt `polaris-supabase`** :

```sql
-- evals-playground : pourquoi un résultat servi n'a pas pu être contrôlé.
--
-- Le contrôle passe après coup sur les lignes dont `faithful` est nul. Quand
-- il lève — une clé morte chez son fournisseur, un quota — la ligne restait
-- nulle indéfiniment, et rien ne distinguait « jamais tenté » de « tenté,
-- échoué ». Un contrôle qui ne se fait jamais ressemblait alors à du calme.
--
-- `faithful` reste nul : on ne SAIT pas, et prétendre le contraire serait
-- faux. Cette colonne dit seulement pourquoi on n'a pas su.
--
-- Elle n'est pas une condamnation : le job resélectionne les lignes dont
-- `faithful` est nul, donc une ligne en erreur est retentée au passage
-- suivant, et un contrôle réussi l'efface. Elle porte la DERNIÈRE raison.
alter table tool_results
  add column check_error text;

comment on column tool_results.check_error is
  'Pourquoi le contrôle n''a pas pu se faire, ou NULL. faithful reste nul dans ce cas — on ne sait pas. Effacée dès qu''un contrôle réussit : c''est la dernière raison, pas un verdict.';
```

- [ ] **Step 2: Pousser, commiter et pousser le dépôt**

```bash
supabase db push --workdir /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase/evals
git -C /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase add evals/supabase/migrations/20260907190000_tool_results_check_error.sql
git -C /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase commit -m "feat(evals): pourquoi un résultat servi n'a pas pu être contrôlé"
git -C /Users/sverbo/Desktop/Codes/Polaris/polaris-supabase push origin main
```

L'utilisateur a autorisé le merge direct et le push sur ce dépôt.

- [ ] **Step 3: Vérifier la colonne**

```bash
curl -s "$SUPABASE_URL/rest/v1/tool_results?select=check_error&limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Attendu : un JSON, pas une erreur de colonne inconnue. Ne jamais imprimer la clé.

- [ ] **Step 4: Écrire l'écrivain et enregistrer la raison**

Dans `supabase_store.py`, à côté de `write_tool_verdict` :

```python
def write_tool_check_error(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    *,
    reason: str,
) -> None:
    """Pourquoi cette ligne n'a pas pu être contrôlée.

    `faithful` n'est pas touché : il reste nul, parce qu'on ne sait pas. La
    ligne repassera donc au prochain contrôle, et un succès effacera cette
    raison — c'est la dernière, pas un verdict.
    """
```

Dans `batch_job.py`, le `except Exception: continue` devient :

```python
        except Exception as e:
            # Une ligne qu'on n'a pas su contrôler reste à contrôler — mais on
            # dit désormais pourquoi. Muette, elle ressemblait à du calme.
            write_tool_check_error(
                supabase, run_id, index, str(ligne["tool_name"]),
                str(ligne["arguments_hash"]),
                reason=f"{type(e).__name__}: {e}"[:500],
            )
            continue
```

Et le succès efface : `write_tool_verdict` écrit `check_error: None` en même temps que `faithful` et `fault`.

- [ ] **Step 5: Lancer pytest, puis commit**

```bash
git add backend/playground/supabase_store.py backend/playground/batch_job.py tests/
git commit -m "feat: un contrôle qui échoue dit pourquoi, au lieu de se taire"
```

---

### Task 7 : Les avertissements « servi depuis un monde vide »

**Files:**
- Create: `web/lib/world-warnings.ts`, `web/lib/world-warnings.test.mts`

**Interfaces:**
- Consumes : `served`, `toolsFor` (Task 1 et l'existant).
- Produces : `worldWarnings(config: EvalRunConfig): string[]` et `extendWorldWarnings(request, runConfig): string[]`.

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

```typescript
test("un run qui porte un monde n'avertit personne", () => {
  assert.deepEqual(worldWarnings(configServiAvecMonde()), []);
});

test("un scénario servi sans aucun monde est signalé, par son titre", () => {
  const config = configServiSansMonde();
  const [warning] = worldWarnings(config);
  assert.ok(warning?.includes(config.scenarios[0].title));
});

test("un scénario qui porte son propre monde suffit", () => {
  const config = configServiSansMonde();
  config.scenarios[0].world = "Shared drive of the legal team.";
  assert.deepEqual(worldWarnings(config), []);
});

test("un scénario sans outil servi n'est jamais signalé", () => {
  // Le monde ne lui sert à rien : l'avertir serait du bruit.
  const config = configServiSansMonde();
  config.scenarios[0].tools = [];
  assert.deepEqual(worldWarnings(config), []);
});

test("appliquer un outil servi à des scénarios existants d'un run au monde vide dit que c'est gelé", () => {
  const warnings = extendWorldWarnings(
    { new_tools: [{ name: "s", description: "d", parameters: [], retrieval_rules: "r" }],
      new_tools_for_existing: true },
    { world: "", scenarios: [{ title: "T", tools: null }] },
  );
  assert.ok(warnings[0]?.includes("frozen"));
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

- [ ] **Step 3: Écrire le module**

L'en-tête doit porter la raison d'être du fichier :

```typescript
// Ce qui mérite d'être dit sans être refusé.
//
// Servir un outil depuis un monde vide est presque toujours une faute : le
// modèle improvise, et improviser est exactement ce que l'outil servi existe
// pour éviter. Presque — un outil purement calculatoire, dont les
// `retrieval_rules` suffisent à tout produire, n'a aucun monde à lire.
// Refuser interdirait cet usage-là pour attraper la faute probable ; on
// nomme la faute et on laisse passer.
//
// Hors de `validate.ts`, délibérément : ces fonctions-là ne rendent que des
// refus. Un refus arrête, un avertissement informe, et les mélanger ferait
// qu'un jour l'un se comporterait comme l'autre.
```

Textes rendus, en anglais :

- par scénario : ``\`${title}\`: served from an empty world — neither the run nor this scenario describes anything to read, so the model will improvise. That is what a served tool exists to avoid.``
- gelé : `"This extension serves tools on scenarios the run has already played, and the run's world is empty. A run's world is frozen at launch, so those scenarios cannot be given one — only new scenarios can carry their own."`

- [ ] **Step 4: Lancer les tests, puis commit**

```bash
git add web/lib/world-warnings.ts web/lib/world-warnings.test.mts
git commit -m "feat: servir depuis un monde vide s'avertit"
```

---

### Task 8 : Le prompt, et la surface MCP

**Files:**
- Modify: `web/lib/agent-prompt.ts`, `web/app/mcp/route.ts`, `web/lib/mcp-favorites.ts`
- Test: `web/lib/agent-prompt.test.mts`, `web/lib/mcp-favorites.test.mts`

**Interfaces:**
- Consumes : tout ce qui précède.

- [ ] **Step 1: Écrire les tests, qui doivent échouer**

```typescript
test("le prompt annonce models.world et son équivalence", () => {
  const prompt = agentPrompt(agentModels(DEFAULT_FAVORITE_MODELS), "https://example.test");
  assert.match(prompt, /models\.world/);
  assert.match(prompt, /required as soon as one tool has/i);
});

test("models.world hors favoris est refusé", () => {
  const config = configAvecOutilServi();
  config.models.world = "openai/gpt-4o";
  const problem = configFavouritesProblem(config, ["anthropic/claude-opus-5"]);
  assert.ok(problem?.includes("openai/gpt-4o"));
});

test("le world d'une extension hors favoris est refusé", () => {
  const problem = extendFavouritesProblem(
    { targets: [], world: "openai/gpt-4o" } as unknown as ExtendRequest,
    ["anthropic/claude-opus-5"],
  );
  assert.ok(problem?.includes("openai/gpt-4o"));
});
```

- [ ] **Step 2: Le lancer pour le voir échouer**

- [ ] **Step 3: Étendre les vérifications de favoris**

Dans `web/lib/mcp-favorites.ts`, ajouter à la liste que parcourt `configFavouritesProblem` :
`{ id: config.models.world, where: "models.world" }`, et à `extendFavouritesProblem` :
`{ id: request.world, where: "world" }`.

- [ ] **Step 4: Documenter dans le prompt**

Dans `web/lib/agent-prompt.ts` :

- bloc `models:` du gabarit : ajouter `world: {{WORLD}}   # serves the tools with retrieval_rules; required as soon as one has them` ;
- `{{WORLD}}` rempli comme les autres, par `example(3)` avec le même repli ;
- « Rules the tool enforces » : ajouter la ligne
  `- \`models.world\` is required as soon as one tool has \`retrieval_rules\`, and refused when none has.` ;
- section « Writing the world » : dire que le run nomme le serveur, et qu'il se paie à chaque appel servi ;
- la phrase du devis sur les appels servis : au tarif du modèle nommé, non d'une constante.

- [ ] **Step 5: Réparer et documenter la surface MCP**

Dans `web/app/mcp/route.ts` :

- `new_tools` gagne `retrieval_rules: z.string().optional().describe("How this tool reads the world. Written instead of result, never both — a tool carries one or the other.")`, et `result` devient `.optional()` ;
- `submit_draft_extension` gagne `world: z.string().optional().describe("The model that serves tools with retrieval_rules. Required when this call adds one to a run that serves none yet; inherited, and unchangeable, when the run already serves.")` ;
- la phrase « needing no model or depth of its own » devient « needing no depth of its own, and no model unless the tool carries retrieval_rules » ;
- `launch_draft` : « which calls three model providers » devient « four ».

- [ ] **Step 6: Lancer les suites, puis commit**

```bash
git add web/lib/agent-prompt.ts web/lib/agent-prompt.test.mts web/lib/mcp-favorites.ts web/lib/mcp-favorites.test.mts web/app/mcp/route.ts
git commit -m "feat: l'agent lit le modèle du monde, et peut servir un outil par extension"
```

---

### Task 9 : Les écrans

**Files:**
- Modify: `web/app/page.tsx`, `web/components/ExtendPanel.tsx`, `web/components/RunRead.tsx`

- [ ] **Step 1: Le select sur la page de run**

À côté du champ du monde (chercher `The world — what exists`), un select **World model** :

- parmi les favoris — les mêmes `modelRows` que les autres sélecteurs ;
- **affiché seulement** si `servesTools(tools)` ;
- **sans présélection** : première option `<option value="">Pick the model that serves your tools…</option>` ;
- l'état `world` du formulaire part dans `models.world` au lancement.

- [ ] **Step 2: Les avertissements**

Sous le champ du monde, rendre `worldWarnings(config)` en ambre, chacun sur sa ligne. Ne rien afficher quand la liste est vide.

- [ ] **Step 3: Le panneau d'extension**

Même select, affiché seulement quand le run n'a pas de `models.world` **et** que l'extension ajoute un outil servi. Et `extendWorldWarnings` rendu en ambre.

- [ ] **Step 4: La ligne ambre de la matrice**

Dans `web/components/RunRead.tsx`, `servedPhrase` s'étoffe : combien n'ont pas tenu, **et** combien n'ont pas pu être contrôlés, avec la dernière raison. Rien par case.

- [ ] **Step 5: Vérifier et commiter**

```bash
npx tsc --noEmit && npx eslint app lib components
git add web/app/page.tsx web/components/ExtendPanel.tsx web/components/RunRead.tsx
git commit -m "feat: on choisit le modèle du monde à l'écran, et les avertissements s'y voient"
```

---

### Task 10 : Le tour complet

- [ ] **Step 1: Les quatre suites**

```bash
.venv/bin/python -m pytest -q
cd web && npm test && npx tsc --noEmit && npx eslint app lib components
```

- [ ] **Step 2: Un vrai run servi**

Avec `scripts/dev.sh` : un scénario, un outil à `retrieval_rules`, un monde, `models.world` choisi. Vérifier que la case se remplit, que le résultat servi est cohérent avec le monde, et que le contrôle passe.

- [ ] **Step 3: Les refus, par MCP ou par la fonction**

Les deux du lancement, les trois de l'extension, et les deux avertissements.

---

## Ce que ce plan ne fait pas

- **La santé des fournisseurs** — savoir qu'une clé est morte, écarter un fournisseur. Nommé dans le spec comme un chantier à part.
- **Rien par case dans la matrice** — seule la ligne de résumé s'étoffe.
- **Le contrôleur ne devient pas un réglage du run.**
