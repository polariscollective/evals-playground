# La longueur de sortie déclarée et mesurée — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la table de longueurs par modèle écrite en dur par un nombre déclaré au niveau du run, et mesurer cette longueur sur les jetons réellement facturés quand on étend un run existant.

**Architecture:** Un champ `average_output_tokens` entre dans `EvalRunConfig` et devient la seule hypothèse d'un run neuf. Les deux estimateurs jumeaux (TypeScript et Python) cessent de chercher une longueur par modèle et acceptent une longueur par scénario. Un module pur neuf, `web/lib/measured-length.ts`, dérive ces longueurs de `eval_samples.usage` ; `extendRun` les lui demande.

**Tech Stack:** Next.js 15 / TypeScript (`web/`), Python 3 + Pydantic + inspect_ai (`backend/`), JSON partagé (`shared/pricing.json`), tests `node --test` et `pytest`.

## ⏸ Ce plan est en attente — à rebaser avant de l'exécuter

Écrit le 4 septembre contre un code qui a changé depuis. Une session Claude
Code concurrente mène le plan `2026-09-05-approfondir-un-run.md` dans le même
dossier, et sa tâche 3 (commit `8d05845`) a réécrit `web/lib/pricing.ts` pour
chiffrer une continuation sans refacturer les tours déjà joués.

**Avant tout dispatch, relire et réaligner :**

- **Tâche 2** — `estimateTokens` n'est plus celle que le plan cite. Le
  paramètre par scénario doit se poser *par-dessus* la logique de continuation,
  pas à sa place. Lire `web/lib/pricing.ts` et `web/lib/deepening.test.mts`
  avant d'écrire quoi que ce soit.
- **Tâche 4** — `ExtendRequest` porte désormais `turns` et `deepen`. Une
  extension qui approfondit facture des tours neufs : la liste de longueurs
  passée à `estimateCost` reste juste, l'unité étant le tour, mais le câblage
  doit passer par leur chemin de continuation.
- **Tâche 5** — leurs tâches 6 et 7 réécrivent `ExtendPanel.tsx` et la page du
  run. Attendre qu'elles aient atterri.

Les tâches **1** (le champ déclaré) et **3** (`measured-length.ts`, fichier
neuf) sont indépendantes de tout cela et restent exactes telles qu'écrites.

---

## Global Constraints

- **Les deux estimateurs sont jumeaux.** Toute règle de calcul ajoutée à `web/lib/pricing.ts` l'est aussi à `backend/playground/pricing.py`, et réciproquement. Un cas testé d'un côté est testé de l'autre.
- **`shared/pricing.json` est la source unique.** Aucune constante de tarif ou de calibration n'est écrite en dur dans le code des deux côtés.
- **Bornes du champ :** entier, `1` à `100000` inclus. Hors bornes, le document est refusé, jamais corrigé en silence.
- **Le nombre inclut le raisonnement.** Tout libellé visible (prompt d'agent, champ du navigateur, message de validation) le dit explicitement.
- **Langue :** commentaires, docstrings et noms de tests en français ; identifiants de code en anglais. C'est la convention du dépôt.
- **Le champ est optionnel dans les types, obligatoire dans `configProblem`.** Les runs et brouillons déjà en base n'ont pas ce champ et doivent rester lisibles.
- **Nom exact du champ :** `average_output_tokens`. Jamais `average_answer_tokens`, jamais `response_tokens`.
- **Ne pas toucher** `web/components/SharedRunView.tsx` : il porte une modification non commitée qui n'appartient pas à ce chantier.

---

## Structure des fichiers

| fichier | responsabilité | état |
|---|---|---|
| `shared/pricing.json` | tarifs et calibrations | modifié — `output_tokens_per_call` retiré |
| `web/lib/types.ts` | types partagés du front | modifié — `average_output_tokens`, `LengthAssumption` |
| `backend/playground/eval_schemas.py` | schémas Pydantic | modifié — `average_output_tokens` |
| `web/lib/validate.ts` | ce qui refuse un document | modifié — le champ devient obligatoire |
| `web/lib/config-file.ts` | aller-retour YAML | modifié — le champ traverse |
| `web/lib/agent-prompt.ts` | le prompt lu par les agents | modifié — le champ documenté |
| `web/lib/pricing.ts` | devis, côté TypeScript | modifié — longueur par scénario |
| `backend/playground/pricing.py` | devis, côté Python | modifié — jumeau |
| `web/lib/measured-length.ts` | **créé** — mesure les longueurs d'un run terminé | pur, sans base ni réseau |
| `web/lib/runs.ts` | accès Supabase aux runs | modifié — `extendRun` mesure |
| `web/app/api/estimate/route.ts` | route de devis | modifié — le paramètre de requête part |
| `web/lib/api.ts` | client des routes | modifié — idem |
| `web/app/page.tsx` | formulaire de composition | modifié — le champ, sans placeholder |
| `web/components/ExtendPanel.tsx` | panneau d'extension | modifié — annonce ce qu'il a mesuré |

---

## Task 1 : Le champ déclaré

**Files:**
- Modify: `web/lib/types.ts:112-134` (`EvalRunConfig`)
- Modify: `backend/playground/eval_schemas.py:241` (`EvalRunConfig`)
- Modify: `web/lib/validate.ts:153` (`configProblem`)
- Modify: `web/lib/config-file.ts:236-256` (lecture) et `:303-320` (écriture)
- Modify: `web/lib/agent-prompt.ts:57` (bloc YAML d'exemple)
- Test: `web/lib/config-file.test.mts`, `tests/test_eval_schemas.py`

**Interfaces:**
- Consumes: rien.
- Produces: `EvalRunConfig.average_output_tokens?: number` (TS) / `average_output_tokens: int | None` (Python). Les tâches 2, 3, 4 et 5 le lisent.

- [ ] **Step 1 : Écrire les tests qui échouent**

Dans `web/lib/config-file.test.mts`, ajouter :

```ts
test("average_output_tokens traverse l'aller-retour YAML", () => {
  const config = { ...CONFIG_MINIMAL, average_output_tokens: 2400 };
  const { config: relu } = readConfigFile(writeConfigFile(config));
  assert.equal(relu.average_output_tokens, 2400);
});

test("un document sans average_output_tokens ne l'invente pas", () => {
  const { config } = readConfigFile(writeConfigFile(CONFIG_MINIMAL));
  assert.equal(config.average_output_tokens, undefined);
});
```

Dans le même fichier (`configProblem` y est déjà importé ; sinon l'importer depuis `./validate.ts`) :

```ts
test("un document sans average_output_tokens est refusé", () => {
  const { average_output_tokens: _, ...sans } = {
    ...CONFIG_MINIMAL,
    average_output_tokens: 800,
  };
  assert.match(
    configProblem(sans) ?? "",
    /average_output_tokens/,
  );
});

test("une longueur hors bornes est refusée plutôt que ramenée", () => {
  assert.ok(configProblem({ ...CONFIG_MINIMAL, average_output_tokens: 0 }));
  assert.ok(configProblem({ ...CONFIG_MINIMAL, average_output_tokens: 100_001 }));
  assert.ok(configProblem({ ...CONFIG_MINIMAL, average_output_tokens: 12.5 }));
  assert.equal(
    configProblem({ ...CONFIG_MINIMAL, average_output_tokens: 800 }),
    null,
  );
});
```

`CONFIG_MINIMAL` doit être une config valide *avec* `average_output_tokens: 800`. Si le fichier de test en définit déjà une sans le champ, l'y ajouter — sans quoi tous les autres tests du fichier casseront à l'étape 3.

Dans `tests/test_eval_schemas.py` :

```python
def test_la_longueur_de_sortie_declaree_est_optionnelle():
    """Les runs enregistrés avant ce champ doivent rester lisibles."""
    config = EvalRunConfig(**_config_minimale())
    assert config.average_output_tokens is None


def test_la_longueur_de_sortie_declaree_traverse_le_schema():
    config = EvalRunConfig(**_config_minimale(), average_output_tokens=2400)
    assert config.average_output_tokens == 2400


@pytest.mark.parametrize("valeur", [0, -1, 100_001])
def test_une_longueur_de_sortie_hors_bornes_est_refusee(valeur: int):
    with pytest.raises(ValidationError):
        EvalRunConfig(**_config_minimale(), average_output_tokens=valeur)
```

Si `_config_minimale()` n'existe pas dans ce fichier, la construire sur le modèle de `tests/test_pricing.py:24-29`.

- [ ] **Step 2 : Les faire échouer**

```bash
cd web && npm test 2>&1 | tail -30
cd .. && pytest tests/test_eval_schemas.py -v
```

Attendu : les nouveaux tests échouent, `average_output_tokens` étant inconnu partout.

- [ ] **Step 3 : Le champ dans les deux schémas**

`web/lib/types.ts`, dans `EvalRunConfig`, après `max_tool_calls_per_turn` :

```ts
  /** Combien de jetons de sortie une réponse du modèle évalué consomme, en gros.
   *
   * Sert au devis et à rien d'autre : ce nombre ne change pas ce que le run
   * fait. Il compte **tout** ce que le modèle produit à chaque appel —
   * raisonnement compris, pas seulement la réponse qu'on lit. C'est l'unité
   * que les fournisseurs facturent, et un modèle qui réfléchit avant de
   * répondre dépense plusieurs fois sa réponse visible.
   *
   * Optionnel dans le type et obligatoire dans `configProblem` : les runs
   * enregistrés avant ce champ n'en ont pas et doivent rester lisibles. */
  average_output_tokens?: number;
```

`backend/playground/eval_schemas.py`, dans `EvalRunConfig` :

```python
    average_output_tokens: int | None = Field(default=None, ge=1, le=100_000)
    """Jetons de sortie que consomme une réponse du modèle évalué, en gros.

    Ne sert qu'au devis : ce nombre ne change rien à ce que le run fait. Il
    compte tout ce que le modèle produit à chaque appel, raisonnement compris —
    c'est l'unité facturée, et `actual_cost` ne facture que `output_tokens`
    précisément parce que le raisonnement y est déjà.

    `None` pour les runs enregistrés avant ce champ : le devis retombe alors
    sur `DEFAULT_RESPONSE_TOKENS`.
    """
```

- [ ] **Step 4 : La validation**

`web/lib/validate.ts`, dans `configProblem`, juste après le bloc `repetitions` :

```ts
  const sortie = c.average_output_tokens;
  if (sortie === undefined || sortie === null) {
    return (
      "average_output_tokens is required: roughly how many output tokens one " +
      "model answer costs, reasoning included, not just the visible reply"
    );
  }
  if (!Number.isInteger(sortie) || sortie < 1 || sortie > 100_000) {
    return "average_output_tokens must be a whole number between 1 and 100000";
  }
```

- [ ] **Step 5 : L'aller-retour YAML**

`web/lib/config-file.ts`, dans la lecture (vers la ligne 249, à côté de `max_tool_calls_per_turn`) :

```ts
    average_output_tokens:
      typeof file.average_output_tokens === "number"
        ? file.average_output_tokens
        : undefined,
```

Et dans l'écriture (vers la ligne 320) :

```ts
    ...(config.average_output_tokens === undefined
      ? {}
      : { average_output_tokens: config.average_output_tokens }),
```

L'omettre plutôt que d'écrire `undefined` : un document relu ne doit pas gagner une clé que l'original n'avait pas.

- [ ] **Step 6 : Le prompt de l'agent**

`web/lib/agent-prompt.ts`, dans le bloc YAML d'exemple, juste avant `turns:` :

```
average_output_tokens: 800   # jetons de sortie d'une réponse, raisonnement compris
turns: 4                # 1 = a single question and answer
```

Et, dans la prose qui suit le bloc, ajouter un paragraphe :

```
`average_output_tokens` is what one answer from an evaluated model costs in
output tokens — reasoning included, not just the reply you would read. A model
that thinks before answering spends several times its visible answer, and that
thinking is billed. The number only feeds the cost estimate; it changes nothing
about what the run does, and it is necessarily rough, since tools and turns
move it. Give your honest guess rather than a round number that looks safe: a
short exchange runs a few hundred tokens, a written-out analysis a few
thousand.
```

- [ ] **Step 7 : Faire passer les tests**

```bash
cd web && npm test 2>&1 | tail -20
cd .. && pytest tests/test_eval_schemas.py -v
```

Attendu : PASS des deux côtés. Les tests de `web/lib/agent-prompt.test.mts` qui vérifient le contenu du prompt peuvent demander une mise à jour — le bloc YAML a changé.

- [ ] **Step 8 : Commit**

```bash
git add web/lib/types.ts web/lib/validate.ts web/lib/config-file.ts \
        web/lib/agent-prompt.ts web/lib/config-file.test.mts \
        web/lib/agent-prompt.test.mts \
        backend/playground/eval_schemas.py tests/test_eval_schemas.py
git commit -m "feat: un run déclare la longueur de sortie qu'il suppose

Un seul nombre pour le run, obligatoire à la validation et optionnel dans le
type pour que les runs déjà enregistrés restent lisibles. Il compte le
raisonnement, parce que c'est ce que les fournisseurs facturent et que personne
n'y pense spontanément."
```

---

## Task 2 : Les estimateurs prennent une longueur par scénario

**Files:**
- Modify: `shared/pricing.json:11-17` (retirer `output_tokens_per_call`)
- Modify: `web/lib/pricing.ts:36-48, 94-200, 260-300`
- Modify: `backend/playground/pricing.py:33-100, 240-345, 378-424`
- Modify: `web/lib/types.ts` (`LengthAssumption`)
- Test: `tests/test_pricing.py`, Create: `web/lib/pricing.test.mts`

**Interfaces:**
- Consumes: `EvalRunConfig.average_output_tokens` (Task 1).
- Produces:
  - TS : `export type LengthAssumption = { answer?: number | number[] | null; adversary?: number | null }` et `estimateCost(config: EvalRunConfig, lengths?: LengthAssumption | number | null): CostEstimate`.
  - Python : `estimate_cost(config: EvalRunConfig, lengths: LengthAssumption | int | None = None) -> CostEstimate` avec `@dataclass(frozen=True) class LengthAssumption: answer: int | Sequence[int] | None = None; adversary: int | None = None`.
  - Un nombre nu vaut `{answer: n, adversary: n}`. La tâche 4 passe une liste alignée sur `config.scenarios`.

- [ ] **Step 1 : Écrire les tests qui échouent (Python)**

Dans `tests/test_pricing.py`, **supprimer** `test_chaque_modele_mesure_prend_sa_propre_longueur_de_reponse`, `test_un_modele_jamais_mesure_prend_la_moyenne_generale` et `test_une_longueur_imposee_ecrase_la_calibration_de_chaque_modele` (lignes 184-201) : ils testent la table qui disparaît. Retirer `OUTPUT_TOKENS_PER_CALL` et `response_tokens_for` de l'import en tête.

Réécrire `test_un_modele_bavard_coute_plus_qu_un_modele_laconique_a_tarif_egal` : les deux modèles ayant désormais la même longueur, c'est la **config** qui change.

```python
def test_une_longueur_declaree_plus_grande_coute_plus_cher():
    """Le devis doit voir ce que la longueur déclarée change, et rien d'autre."""
    bavard = estimate_cost(_config_reglable(), 4000)
    laconique = estimate_cost(_config_reglable(), 200)
    assert bavard.usd > laconique.usd


def test_sans_rien_de_declare_le_devis_prend_la_moyenne_generale():
    config = _config_reglable()
    assert config.average_output_tokens is None
    assert estimate_cost(config).response_tokens == DEFAULT_RESPONSE_TOKENS


def test_le_devis_prend_la_longueur_declaree_par_la_config():
    config = _config_reglable(average_output_tokens=2400)
    assert estimate_cost(config).response_tokens == 2400
    assert estimate_cost(config).usd > estimate_cost(_config_reglable(), 200).usd


def test_une_longueur_par_scenario_s_applique_scenario_par_scenario():
    """C'est ce dont l'extension a besoin : un run à deux scénarios de
    longueurs différentes ne coûte pas le même run à leur moyenne."""
    config = _config_reglable(scenarios=[_scenario("A"), _scenario("B")])
    separe = estimate_cost(config, LengthAssumption(answer=[200, 4000]))
    moyenne = estimate_cost(config, LengthAssumption(answer=[2100, 2100]))
    assert separe.usd != moyenne.usd


def test_une_longueur_qui_varie_se_declare_inconnue():
    """`response_tokens` dit l'hypothèse retenue. Il n'y en a plus une seule
    quand chaque scénario a la sienne : `None` le dit honnêtement."""
    config = _config_reglable(scenarios=[_scenario("A"), _scenario("B")])
    assert estimate_cost(config, LengthAssumption(answer=[200, 4000])).response_tokens is None
    assert estimate_cost(config, LengthAssumption(answer=[300, 300])).response_tokens == 300


def test_l_adversaire_prend_sa_propre_longueur_quand_on_la_donne():
    config = _config_reglable()
    bavard = estimate_cost(config, LengthAssumption(answer=500, adversary=4000))
    laconique = estimate_cost(config, LengthAssumption(answer=500, adversary=50))
    assert bavard.usd > laconique.usd


def test_sans_longueur_d_adversaire_il_prend_celle_des_reponses():
    config = _config_reglable()
    implicite = estimate_cost(config, LengthAssumption(answer=500))
    explicite = estimate_cost(config, LengthAssumption(answer=500, adversary=500))
    assert implicite.usd == explicite.usd
```

`_config_reglable` doit accepter des mots-clés (`**kwargs` passés à `EvalRunConfig`) s'il ne le fait pas déjà. Ajouter `LengthAssumption` à l'import depuis `playground.pricing`.

Adapter aussi `test_sans_hypothese_imposee_le_devis_le_dit` (ligne 308) : `response_tokens` ne vaut plus `None` sans hypothèse mais `DEFAULT_RESPONSE_TOKENS`. Le test au-dessus le remplace ; supprimer l'ancien.

- [ ] **Step 2 : Les faire échouer**

```bash
pytest tests/test_pricing.py -v
```

Attendu : FAIL, `LengthAssumption` n'existe pas et `response_tokens` vaut encore `None`.

- [ ] **Step 3 : Retirer la table**

Dans `shared/pricing.json`, supprimer la clé `output_tokens_per_call` entière (lignes 11-17) et la virgule qui la précède si besoin. Vérifier :

```bash
python3 -c "import json; d=json.load(open('shared/pricing.json')); assert 'output_tokens_per_call' not in d; print('ok')"
```

- [ ] **Step 4 : L'estimateur Python**

Dans `backend/playground/pricing.py` :

Supprimer `OUTPUT_TOKENS_PER_CALL` (ligne 60) et sa docstring, et la fonction `response_tokens_for` (lignes 90-100). Corriger la docstring de `CHARS_PER_TOKEN` (ligne 33-37) et celle de `DEFAULT_RESPONSE_TOKENS` (lignes 51-57), qui renvoient toutes deux à la table disparue :

```python
DEFAULT_RESPONSE_TOKENS = _SHARED["default_response_tokens"]
"""Longueur supposée quand rien n'est déclaré ni mesuré.

C'est la moyenne tous modèles confondus relevée le 19 août 2026. Elle ne sert
plus qu'aux runs enregistrés avant `average_output_tokens` : un run neuf déclare
sa longueur, une extension la mesure.
"""
```

Ajouter, après `DEFAULT_RESPONSE_TOKENS` :

```python
@dataclass(frozen=True)
class LengthAssumption:
    """Sur quelle longueur de sortie le devis repose.

    `answer` porte les réponses du modèle évalué : un nombre pour tous les
    scénarios, ou un par scénario dans l'ordre de `config.scenarios` — ce dont
    l'extension a besoin, chaque scénario ayant sa propre mesure. `None` renvoie
    à `config.average_output_tokens`.

    `adversary` porte les tours d'utilisateur, qui ne sont pas des réponses
    évaluées et ne dépendent pas du scénario mais de la consigne d'adversaire,
    commune au run. `None` lui donne la longueur déclarée du run, ce qui
    surestime — les tours d'utilisateur étant plus courts — et c'est le bon sens
    de l'erreur pour un devis.
    """

    answer: int | Sequence[int] | None = None
    adversary: int | None = None


def _clamp(tokens: int) -> int:
    return max(1, min(int(tokens), 100_000))


def _declared(config: EvalRunConfig) -> int:
    return _clamp(config.average_output_tokens or DEFAULT_RESPONSE_TOKENS)


def _resolve(
    config: EvalRunConfig, lengths: "LengthAssumption | int | None"
) -> tuple[list[int], int]:
    """Les longueurs de chaque scénario, et celle de l'adversaire.

    Un nombre nu vaut « la même pour tout le monde » : c'est la forme dont se
    servent les bornes court/long, qui encadrent le devis sans rien savoir des
    scénarios.
    """
    if lengths is None:
        lengths = LengthAssumption()
    elif isinstance(lengths, int):
        lengths = LengthAssumption(answer=lengths, adversary=lengths)

    declared = _declared(config)
    answer = lengths.answer
    if answer is None:
        par_scenario = [declared] * len(config.scenarios)
    elif isinstance(answer, int):
        par_scenario = [_clamp(answer)] * len(config.scenarios)
    else:
        # Une liste plus courte que les scénarios n'est pas une erreur : une
        # extension peut n'avoir mesuré qu'une partie d'entre eux.
        par_scenario = [
            _clamp(answer[index]) if index < len(answer) else declared
            for index in range(len(config.scenarios))
        ]

    adversary = _clamp(lengths.adversary) if lengths.adversary is not None else declared
    return par_scenario, adversary
```

Ajouter `Sequence` à l'import : `from collections.abc import Sequence`.

Dans `estimate_tokens`, remplacer la signature et les deux appels à `response_tokens_for` :

```python
def estimate_tokens(
    config: EvalRunConfig, lengths: "LengthAssumption | int | None" = None
) -> TokenEstimate:
    """Volume total d'un run, réparti par modèle.

    Chaque scénario est déroulé avec sa propre longueur de réponse : comme
    l'historique complet est renvoyé à chaque tour, un scénario qui appelle des
    réponses longues enfle aussi l'entrée de l'adversaire et celle du juge.

    La longueur est celle d'un *tour*, pas d'un appel HTTP : la boucle
    ci-dessous compte exactement `config.turns` appels du modèle évalué, sans
    modèle des appels d'outils. Une mesure divisée par les tours reproduit donc
    le total observé, quand une mesure divisée par les appels réels le
    sous-estimerait.

    Args:
        config: Le run à estimer.
        lengths: Sur quelle longueur reposer. Voir `LengthAssumption`.
    """
    per_scenario, adversary_response_all = _resolve(config, lengths)
    per_model: dict[str, ModelTokens] = {}
    judge = config.models.judge
    adversary = config.models.adversary if config.turns > 1 else None
    adversary_response = adversary_response_all if adversary else 0
    question = _tokens(config.criterion) + _rubric_tokens(config)
    adversary_prompt = _tokens(config.adversary_prompt)

    for index, scenario in enumerate(config.scenarios):
```

Puis, dans la boucle des cibles, remplacer :

```python
        for target in config.models.targets:
            target_response = per_scenario[index]
```

Le reste de la boucle est inchangé.

Dans `_costs_for` et `estimate_cost`, remplacer le paramètre `response_tokens: int | None` par `lengths: "LengthAssumption | int | None"` et le transmettre tel quel. Dans `estimate_cost`, la valeur annoncée devient :

```python
    per_scenario, _ = _resolve(config, lengths)
    unique = per_scenario[0] if per_scenario and len(set(per_scenario)) == 1 else None

    costs, expected, unpriced = _costs_for(config, lengths)
    _, low, _ = _costs_for(config, SHORT_RESPONSE_TOKENS)
    _, high, _ = _costs_for(config, LONG_RESPONSE_TOKENS)
    volume = estimate_tokens(config, lengths)

    return CostEstimate(
        response_tokens=unique,
        ...
```

Mettre à jour la docstring de `CostEstimate.response_tokens` :

```python
    response_tokens: int | None
    """La longueur supposée, ou `None` si elle varie d'un scénario à l'autre."""
```

- [ ] **Step 5 : Vérifier le Python**

```bash
pytest tests/test_pricing.py -v
```

Attendu : PASS. Puis toute la suite, la table ayant pu servir ailleurs :

```bash
pytest -q
```

- [ ] **Step 6 : Écrire les tests TypeScript**

Créer `web/lib/pricing.test.mts` avec les mêmes cas que le Python — c'est la garantie que les jumeaux ne divergent pas :

```ts
// Les mêmes cas que `tests/test_pricing.py` côté Python : les deux estimateurs
// doivent rendre le même devis, sans quoi le chiffre affiché avant un run et
// celui qu'on enregistre ne parleraient plus de la même chose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCost } from "./pricing.ts";
import { SHARED_PRICING } from "./shared.ts";
import type { EvalRunConfig, EvalScenario } from "./types.ts";

const scenario = (title = "T"): EvalScenario => ({
  title,
  system_prompt: "S".repeat(400),
  opening_message: "O".repeat(200),
});

const config = (extra: Partial<EvalRunConfig> = {}): EvalRunConfig => ({
  scenarios: [scenario()],
  criterion: "C".repeat(100),
  rubric: [
    { value: 0, meaning: "R".repeat(40) },
    { value: 1, meaning: "R".repeat(40) },
  ],
  turns: 3,
  repetitions: 2,
  models: {
    targets: ["anthropic/claude-sonnet-5"],
    adversary: "anthropic/claude-haiku-4-5",
    judge: "openai/gpt-5.6-luna",
  },
  adversary_prompt: "A".repeat(200),
  ...extra,
});

test("sans rien de déclaré, le devis prend la moyenne générale", () => {
  assert.equal(
    estimateCost(config()).response_tokens,
    SHARED_PRICING.default_response_tokens,
  );
});

test("le devis prend la longueur déclarée par la config", () => {
  assert.equal(
    estimateCost(config({ average_output_tokens: 2400 })).response_tokens,
    2400,
  );
});

test("une longueur plus grande coûte plus cher", () => {
  assert.ok(estimateCost(config(), 4000).usd > estimateCost(config(), 200).usd);
});

test("une longueur par scénario s'applique scénario par scénario", () => {
  const deux = config({ scenarios: [scenario("A"), scenario("B")] });
  const separe = estimateCost(deux, { answer: [200, 4000] });
  const moyenne = estimateCost(deux, { answer: [2100, 2100] });
  assert.notEqual(separe.usd, moyenne.usd);
});

test("une longueur qui varie se déclare inconnue", () => {
  const deux = config({ scenarios: [scenario("A"), scenario("B")] });
  assert.equal(estimateCost(deux, { answer: [200, 4000] }).response_tokens, null);
  assert.equal(estimateCost(deux, { answer: [300, 300] }).response_tokens, 300);
});

test("l'adversaire prend sa propre longueur quand on la donne", () => {
  const bavard = estimateCost(config(), { answer: 500, adversary: 4000 });
  const laconique = estimateCost(config(), { answer: 500, adversary: 50 });
  assert.ok(bavard.usd > laconique.usd);
});

test("sans longueur d'adversaire, il prend celle des réponses", () => {
  assert.equal(
    estimateCost(config(), { answer: 500 }).usd,
    estimateCost(config(), { answer: 500, adversary: 500 }).usd,
  );
});

test("les bornes ne bougent pas avec l'hypothèse retenue", () => {
  const bas = estimateCost(config(), 200);
  const haut = estimateCost(config(), 8000);
  assert.equal(bas.min_usd, haut.min_usd);
  assert.equal(bas.max_usd, haut.max_usd);
});
```

- [ ] **Step 7 : Les faire échouer**

```bash
cd web && node --test lib/pricing.test.mts
```

Attendu : FAIL — `estimateCost` n'accepte pas encore d'objet, et `response_tokens` vaut `null` sans hypothèse.

- [ ] **Step 8 : L'estimateur TypeScript**

Dans `web/lib/types.ts`, ajouter à côté de `CostEstimate` :

```ts
/** Sur quelle longueur de sortie un devis repose. Jumeau de `LengthAssumption`
 *  côté Python — les deux doivent accepter exactement les mêmes formes. */
export interface LengthAssumption {
  /** Les réponses du modèle évalué : un nombre pour tous les scénarios, ou un
   *  par scénario dans l'ordre de `config.scenarios`. */
  answer?: number | number[] | null;
  /** Les tours d'adversaire, qui dépendent de sa consigne et non du scénario.
   *  Absent, il prend la longueur déclarée du run. */
  adversary?: number | null;
}
```

Dans `web/lib/pricing.ts` : supprimer `const MEASURED` (ligne 40) et `responseTokensFor` (lignes 41-48). Ajouter :

```ts
const clamp = (tokens: number): number =>
  Math.max(1, Math.min(Math.round(tokens), 100_000));

const declared = (config: EvalRunConfig): number =>
  clamp(config.average_output_tokens || S.default_response_tokens);

/** Les longueurs de chaque scénario, et celle de l'adversaire.
 *
 * Un nombre nu vaut « la même pour tout le monde » : c'est la forme dont se
 * servent les bornes court/long, qui encadrent le devis sans rien savoir des
 * scénarios. */
function resolve(
  config: EvalRunConfig,
  lengths: LengthAssumption | number | null | undefined,
): { perScenario: number[]; adversary: number } {
  const spec: LengthAssumption =
    lengths == null
      ? {}
      : typeof lengths === "number"
        ? { answer: lengths, adversary: lengths }
        : lengths;

  const fallback = declared(config);
  const answer = spec.answer;
  const perScenario = config.scenarios.map((_, index) => {
    if (Array.isArray(answer)) {
      // Une liste plus courte que les scénarios n'est pas une erreur : une
      // extension peut n'avoir mesuré qu'une partie d'entre eux.
      const value = answer[index];
      return value == null ? fallback : clamp(value);
    }
    return answer == null ? fallback : clamp(answer);
  });

  return {
    perScenario,
    adversary: spec.adversary == null ? fallback : clamp(spec.adversary),
  };
}
```

Dans `estimateTokens`, remplacer la signature et l'usage :

```ts
export function estimateTokens(
  config: EvalRunConfig,
  lengths?: LengthAssumption | number | null,
): { conversations: number; modelCalls: number; perModel: Map<string, ModelTokens> } {
  const { perScenario, adversary: adversaryLength } = resolve(config, lengths);
  const perModel = new Map<string, ModelTokens>();
  ...
  const adversaryResponse = adversary ? adversaryLength : 0;
```

Puis la boucle des scénarios devient indexée et la cible lit la longueur du scénario :

```ts
  config.scenarios.forEach((scenario, index) => {
    ...
    for (const target of config.models.targets) {
      const targetResponse = perScenario[index];
```

Attention : `config.scenarios.forEach` remplace `for (const scenario of config.scenarios)` ; le corps est inchangé par ailleurs, et le `}` de fin de boucle devient `});`.

Dans `costsFor` et `estimateCost`, remplacer `responseTokens: number | null` par `lengths: LengthAssumption | number | null | undefined` et transmettre. Le calcul de la valeur annoncée :

```ts
  const { perScenario } = resolve(config, lengths);
  const unique =
    perScenario.length > 0 && new Set(perScenario).size === 1
      ? perScenario[0]
      : null;
```

et `response_tokens: unique` dans l'objet rendu. Supprimer la ligne `const assumed = ...` qui bornait l'override, `clamp` s'en chargeant désormais.

Mettre à jour le commentaire d'en-tête du fichier (lignes 1-7) et le gros commentaire sur Grok (lignes 14-35), qui cite « 5 954 jetons mesurés » — remplacer par « les réponses les plus longues que le devis sait supposer (`long_response_tokens`) ».

Corriger enfin `costSentence` : son commentaire promet « la longueur mesurée pour chacun ». Il appelle `estimateCost(config, null)`, ce qui reste correct — seul le commentaire change.

- [ ] **Step 9 : Faire passer**

```bash
cd web && npm test 2>&1 | tail -20 && npx tsc --noEmit
```

Attendu : PASS et aucune erreur de type. `web/app/page.tsx` va casser à la compilation (`responseTokens` passé à `estimateRun`) — c'est la tâche 5 ; si `tsc` s'en plaint ici, laisser l'erreur et la corriger en tâche 5, ou faire la tâche 5 avant de commiter.

- [ ] **Step 10 : Vérifier que le devis enregistré suit, sans y toucher**

`createRun` (`web/lib/runs.ts:192`) appelle déjà `estimateCost(config)` sans
second argument. Depuis l'étape 8, cet appel résout la longueur depuis
`config.average_output_tokens` : le devis enregistré devient donc celui que
l'auteur a déclaré, **sans modifier `createRun`**. C'est l'un des objets du
chantier ; ne pas « réparer » cette ligne, elle est correcte.

Le commentaire qui la surplombe reste vrai — le devis est recalculé ici plutôt
que repris du navigateur — mais gagne une phrase :

```ts
      // Recalculé ici et non repris du navigateur : le devis enregistré doit
      // être celui que ce code produit, pas celui qu'un client affirme avoir
      // vu. Sans ça, la comparaison d'après ne mesurerait plus rien. La
      // longueur supposée, elle, vient bien du client — mais par la config,
      // qui est validée, et non par un paramètre à côté.
      estimate: estimateCost(config),
```

Vérifier que l'hypothèse circule vraiment :

```bash
cd web && node --test lib/pricing.test.mts
```

Le test « le devis prend la longueur déclarée par la config » couvre ce chemin.

- [ ] **Step 11 : Commit**

```bash
git add shared/pricing.json web/lib/pricing.ts web/lib/pricing.test.mts \
        web/lib/types.ts backend/playground/pricing.py tests/test_pricing.py \
        web/lib/runs.ts
git commit -m "refactor: le devis suppose une longueur par scénario, plus une table par modèle

La table écrite en dur ne couvrait que cinq modèles sur neuf ; les quatre
autres retombaient en silence sur la moyenne générale, sous une phrase qui
promettait une longueur mesurée. Elle rangeait de surcroît par modèle, quand la
longueur tient surtout au scénario.

La longueur devient celle d'un tour de conversation, pas d'un appel HTTP :
c'est l'unité dans laquelle la boucle raisonne, et la seule qui reproduise le
total observé quand un scénario emploie des outils."
```

---

## Task 3 : `measured-length.ts`, la mesure

**Files:**
- Create: `web/lib/measured-length.ts`
- Test: Create `web/lib/measured-length.test.mts`

**Interfaces:**
- Consumes: `EvalModels`, `ModelUsage`, `SampleStatus` de `./types.ts` ; `SHARED_PRICING` de `./shared.ts`.
- Produces:
  - `interface MeasurableCell { scenario_index: number; target_model: string; status: SampleStatus; usage: Record<string, ModelUsage> }`
  - `interface MeasuredLengths { byScenario: Map<number, number>; run: number | null; adversary: number | null; skipped: number }`
  - `measureRun(cells: MeasurableCell[], models: EvalModels, turns: number): MeasuredLengths`
  - `answerLengthsFor(scenarioIndices: number[], measured: MeasuredLengths, declared: number | undefined): number[]`

  La tâche 4 appelle les deux.

- [ ] **Step 1 : Écrire les tests qui échouent**

Créer `web/lib/measured-length.test.mts` :

```ts
// Ce qu'un run terminé sait dire de la longueur de ses réponses.
//
// Le point à protéger est le dénominateur : c'est `turns`, pas le nombre
// d'appels réellement facturés. L'estimateur ne compte que `turns` appels du
// modèle évalué par conversation ; diviser par autre chose lui ferait rendre un
// total différent de celui qu'on a observé.
import { test } from "node:test";
import assert from "node:assert/strict";
import { measureRun, answerLengthsFor } from "./measured-length.ts";
import { SHARED_PRICING } from "./shared.ts";
import type { EvalModels, ModelUsage } from "./types.ts";

const MODELS: EvalModels = {
  targets: ["anthropic/claude-sonnet-5", "grok/grok-4.3"],
  adversary: "anthropic/claude-haiku-4-5",
  judge: "openai/gpt-5.6-luna",
};

const usage = (counts: Record<string, number>): Record<string, ModelUsage> =>
  Object.fromEntries(
    Object.entries(counts).map(([model, output]) => [
      model,
      {
        input_tokens: 0,
        output_tokens: output,
        input_tokens_cache_read: 0,
        input_tokens_cache_write: 0,
        reasoning_tokens: 0,
      },
    ]),
  );

const cell = (
  scenario_index: number,
  target_model: string,
  output: number,
  extra: Record<string, number> = {},
) => ({
  scenario_index,
  target_model,
  status: "done" as const,
  usage: usage({ [target_model]: output, ...extra }),
});

test("une case propre rend ses jetons de sortie divisés par les tours", () => {
  const mesure = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000)],
    MODELS,
    3,
  );
  assert.equal(mesure.byScenario.get(0), 1000);
});

test("deux cases du même scénario se mettent en commun", () => {
  // 3000 + 1000 jetons pour 2 cases × 2 tours = 1000 par tour.
  const mesure = measureRun(
    [
      cell(0, "anthropic/claude-sonnet-5", 3000),
      cell(0, "grok/grok-4.3", 1000),
    ],
    MODELS,
    2,
  );
  assert.equal(mesure.byScenario.get(0), 1000);
});

test("la moyenne du run est mise en commun, pas moyenne de moyennes", () => {
  // Le scénario 0 est joué deux fois à 100, le scénario 1 une fois à 4000.
  // Mise en commun : (100 + 100 + 4000) / 3 cases = 1400 par tour.
  // Moyenne de moyennes, elle, donnerait (100 + 4000) / 2 = 2050.
  const mesure = measureRun(
    [
      cell(0, "anthropic/claude-sonnet-5", 100),
      cell(0, "grok/grok-4.3", 100),
      cell(1, "anthropic/claude-sonnet-5", 4000),
    ],
    MODELS,
    1,
  );
  assert.equal(mesure.run, 1400);
});

test("une case dont le modèle évalué est aussi le juge est écartée", () => {
  const models: EvalModels = { ...MODELS, judge: "anthropic/claude-sonnet-5" };
  const mesure = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000), cell(0, "grok/grok-4.3", 300)],
    models,
    1,
  );
  assert.equal(mesure.byScenario.get(0), 300);
  assert.equal(mesure.skipped, 1);
});

test("une case dont le modèle évalué est aussi l'adversaire est écartée", () => {
  const models: EvalModels = {
    ...MODELS,
    adversary: "anthropic/claude-sonnet-5",
  };
  const mesure = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000), cell(0, "grok/grok-4.3", 300)],
    models,
    1,
  );
  assert.equal(mesure.byScenario.get(0), 300);
  assert.equal(mesure.skipped, 1);
});

test("les cases non terminées ne comptent pas", () => {
  const cells = [
    { ...cell(0, "grok/grok-4.3", 500), status: "error" as const },
    { ...cell(0, "grok/grok-4.3", 500), status: "pending" as const },
    { ...cell(0, "grok/grok-4.3", 500), status: "cancelled" as const },
  ];
  const mesure = measureRun(cells, MODELS, 1);
  assert.equal(mesure.byScenario.size, 0);
  assert.equal(mesure.run, null);
  // Écartées parce qu'inachevées, pas parce qu'un modèle cumulait les rôles.
  assert.equal(mesure.skipped, 0);
});

test("une case sans usage enregistré ne compte pas", () => {
  const mesure = measureRun(
    [{ scenario_index: 0, target_model: "grok/grok-4.3", status: "done" as const, usage: {} }],
    MODELS,
    1,
  );
  assert.equal(mesure.run, null);
});

test("l'adversaire se mesure sur turns − 1 appels par case", () => {
  // 900 jetons d'adversaire, 1 case, 4 tours → 3 appels → 300 par appel.
  const cells = [
    cell(0, "grok/grok-4.3", 1200, { "anthropic/claude-haiku-4-5": 900 }),
  ];
  assert.equal(measureRun(cells, MODELS, 4).adversary, 300);
});

test("à un seul tour, l'adversaire n'est pas mesurable", () => {
  const cells = [cell(0, "grok/grok-4.3", 1200)];
  assert.equal(measureRun(cells, MODELS, 1).adversary, null);
});

test("un scénario mesuré prend sa mesure, un scénario neuf celle du run", () => {
  const mesure = measureRun(
    [
      cell(0, "grok/grok-4.3", 100),
      cell(1, "grok/grok-4.3", 4000),
    ],
    MODELS,
    1,
  );
  // Scénario 0 mesuré, scénario 7 jamais joué → la moyenne du run, 2050.
  assert.deepEqual(answerLengthsFor([0, 7], mesure, 800), [100, 2050]);
});

test("sans aucune case propre, on retombe sur la longueur déclarée", () => {
  const vide = measureRun([], MODELS, 3);
  assert.deepEqual(answerLengthsFor([0, 1], vide, 800), [800, 800]);
});

test("sans déclaration non plus, on retombe sur la moyenne générale", () => {
  const vide = measureRun([], MODELS, 3);
  assert.deepEqual(answerLengthsFor([0], vide, undefined), [
    SHARED_PRICING.default_response_tokens,
  ]);
});

test("le compte des cases retenues est rendu avec la mesure", () => {
  const mesure = measureRun(
    [cell(0, "grok/grok-4.3", 100), cell(1, "grok/grok-4.3", 200)],
    MODELS,
    1,
  );
  assert.equal(mesure.kept, 2);
  assert.equal(mesure.skipped, 0);
});

test("une mesure sur des cases à outils reproduit le total observé", () => {
  // 6000 jetons sur 3 tours, quel que soit le nombre d'appels d'outils qu'il a
  // fallu pour les produire : l'estimateur multipliera 2000 par 3 tours et
  // retombera sur 6000.
  const mesure = measureRun([cell(0, "grok/grok-4.3", 6000)], MODELS, 3);
  assert.equal(mesure.byScenario.get(0)! * 3, 6000);
});
```

- [ ] **Step 2 : Les faire échouer**

```bash
cd web && node --test lib/measured-length.test.mts
```

Attendu : FAIL, `./measured-length.ts` n'existe pas.

- [ ] **Step 3 : Écrire le module**

Créer `web/lib/measured-length.ts` :

```ts
// Ce qu'un run terminé sait dire de la longueur de ses propres réponses.
//
// Le devis d'un run neuf repose sur un nombre déclaré : personne n'a de données
// sur une matrice qui n'a jamais tourné. Une extension, elle, prolonge un run
// qui a fini — ses jetons sont facturés, comptés, enregistrés. Les redemander à
// quelqu'un serait lui faire deviner ce qu'on sait déjà.
//
// Rien ici ne touche à la base ni au réseau : le module prend des cases et rend
// des nombres, pour qu'il se teste seul.
import { SHARED_PRICING as S } from "./shared";
import type { EvalModels, ModelUsage, SampleStatus } from "./types";

/** Ce qu'une case doit porter pour être mesurable. Sciemment plus étroit que
 *  `EvalSample` : ni transcript, ni note, ni date — la requête n'a donc que
 *  quatre colonnes à ramener, là où les transcripts pèsent des centaines de
 *  kilo-octets. */
export interface MeasurableCell {
  scenario_index: number;
  target_model: string;
  status: SampleStatus;
  usage: Record<string, ModelUsage>;
}

export interface MeasuredLengths {
  /** Jetons de sortie par tour, pour chaque scénario qui a des cases propres.
   *  Un scénario absent n'en a aucune. */
  byScenario: Map<number, number>;
  /** La même chose sur tout le run, mise en commun. `null` si rien n'est
   *  mesurable. */
  run: number | null;
  /** Jetons de sortie par tour d'adversaire, ou `null` — run à un seul tour,
   *  adversaire cumulant les rôles, ou rien de mesurable. */
  adversary: number | null;
  /** Combien de cases terminées ont été écartées parce que leur modèle évalué
   *  jouait aussi un autre rôle. Sert à le dire à l'écran plutôt qu'à le taire. */
  skipped: number;
  /** Combien de cases ont effectivement porté la mesure. Un devis appuyé sur
   *  deux cases ne se lit pas comme un devis appuyé sur deux cents. */
  kept: number;
}

interface Pool {
  tokens: number;
  calls: number;
}

const ajouter = (pool: Pool, tokens: number, calls: number): void => {
  pool.tokens += tokens;
  pool.calls += calls;
};

const moyenne = (pool: Pool): number | null =>
  pool.calls > 0 ? Math.round(pool.tokens / pool.calls) : null;

/** Mesure les longueurs de sortie d'un run terminé.
 *
 * Le dénominateur est `turns`, pas le nombre d'appels réellement facturés :
 * l'estimateur n'ajoute la réponse du modèle évalué que `turns` fois par
 * conversation, n'ayant aucun modèle des appels d'outils. Diviser par les
 * appels réels lui ferait rendre moins que le total observé, d'autant plus
 * qu'un scénario emploie des outils. En divisant par les tours, la mesure
 * absorbe cette inflation et le devis reproduit exactement ce qu'on a payé.
 *
 * Une case dont le modèle évalué est aussi juge ou adversaire est écartée :
 * `usage` est indexé par nom de modèle et jamais par rôle, si bien que ses
 * réponses et ses verdicts s'additionnent sur la même ligne — et un
 * re-jugement, que `add_usage` cumule, aggrave encore le mélange. Les écarter
 * ne perd rien : la longueur étant une propriété du scénario et non du modèle,
 * la mesurer sur les modèles qui ne cumulent pas les rôles vaut autant que de
 * la mesurer sur tous. */
export function measureRun(
  cells: MeasurableCell[],
  models: EvalModels,
  turns: number,
): MeasuredLengths {
  const autresRôles = new Set(
    [models.judge, models.adversary].filter((model): model is string =>
      Boolean(model),
    ),
  );
  const adversaire = turns > 1 ? models.adversary : null;
  // Un adversaire qui est aussi évalué ou juge est illisible pour la même
  // raison que les cibles qui cumulent.
  const adversaireLisible =
    adversaire != null &&
    adversaire !== models.judge &&
    !models.targets.includes(adversaire);

  const parScénario = new Map<number, Pool>();
  const run: Pool = { tokens: 0, calls: 0 };
  const adversairePool: Pool = { tokens: 0, calls: 0 };
  let skipped = 0;
  let kept = 0;

  for (const cell of cells) {
    if (cell.status !== "done") continue;

    if (adversaireLisible) {
      const jetons = cell.usage[adversaire]?.output_tokens;
      if (jetons != null) ajouter(adversairePool, jetons, turns - 1);
    }

    if (autresRôles.has(cell.target_model)) {
      skipped += 1;
      continue;
    }
    const jetons = cell.usage[cell.target_model]?.output_tokens;
    // Une case sans compteur n'est pas une case à zéro jeton : elle est muette,
    // et la compter tirerait la moyenne vers le bas sans rien mesurer.
    if (jetons == null) continue;

    const pool = parScénario.get(cell.scenario_index) ?? { tokens: 0, calls: 0 };
    ajouter(pool, jetons, turns);
    parScénario.set(cell.scenario_index, pool);
    ajouter(run, jetons, turns);
    kept += 1;
  }

  const byScenario = new Map<number, number>();
  for (const [index, pool] of parScénario) {
    const valeur = moyenne(pool);
    if (valeur != null) byScenario.set(index, valeur);
  }

  return {
    byScenario,
    run: moyenne(run),
    adversary: adversaireLisible ? moyenne(adversairePool) : null,
    skipped,
    kept,
  };
}

/** La longueur à supposer pour chacun de ces scénarios, dans l'ordre donné.
 *
 * La cascade dit ce qu'on sait, du plus précis au plus vague : la mesure de ce
 * scénario, sinon celle du run — un scénario ajouté ressemblera aux
 * précédents —, sinon ce que l'auteur avait déclaré, sinon la moyenne générale
 * pour les runs antérieurs au champ. */
export function answerLengthsFor(
  scenarioIndices: number[],
  measured: MeasuredLengths,
  declared: number | undefined,
): number[] {
  const repli = measured.run ?? declared ?? S.default_response_tokens;
  return scenarioIndices.map(
    (index) => measured.byScenario.get(index) ?? repli,
  );
}
```

- [ ] **Step 4 : Faire passer**

```bash
cd web && node --test lib/measured-length.test.mts && npx tsc --noEmit
```

Attendu : tous les tests PASS.

- [ ] **Step 5 : Commit**

```bash
git add web/lib/measured-length.ts web/lib/measured-length.test.mts
git commit -m "feat: mesurer la longueur de sortie sur les cases déjà jouées d'un run

Divisée par les tours et non par les appels facturés : c'est l'unité dans
laquelle l'estimateur raisonne, et la seule qui reproduise le total observé
quand un scénario emploie des outils.

Les cases dont le modèle évalué est aussi juge ou adversaire sont écartées —
usage est indexé par modèle et jamais par rôle, leurs réponses et leurs
verdicts s'additionnent. Les écarter ne perd rien, la longueur étant une
propriété du scénario et non du modèle."
```

---

## Task 4 : L'extension mesure

**Files:**
- Modify: `web/lib/runs.ts:326-405` (`extendRun`)
- Test: `web/lib/extend.test.mts` (cas d'intégration du choix des longueurs)

**Interfaces:**
- Consumes: `measureRun`, `answerLengthsFor`, `MeasurableCell` (Task 3) ; `estimateCost(config, LengthAssumption)` (Task 2).
- Produces: rien de nouveau — `extendRun` garde sa signature.

- [ ] **Step 1 : Écrire le test qui échoue**

Dans `web/lib/extend.test.mts`, ajouter un cas sur la composition — la fonction pure que la tâche 3 fournit, appliquée comme `extendRun` l'appliquera :

```ts
test("l'extension estime sur ce que le run a mesuré, pas sur une constante", () => {
  const models: EvalModels = {
    targets: ["grok/grok-4.3"],
    adversary: "anthropic/claude-haiku-4-5",
    judge: "openai/gpt-5.6-luna",
  };
  const mesure = measureRun(
    [
      {
        scenario_index: 0,
        target_model: "grok/grok-4.3",
        status: "done",
        usage: {
          "grok/grok-4.3": {
            input_tokens: 0,
            output_tokens: 6000,
            input_tokens_cache_read: 0,
            input_tokens_cache_write: 0,
            reasoning_tokens: 0,
          },
        },
      },
    ],
    models,
    3,
  );

  // Le scénario 0 a mesuré 2000 jetons par tour ; le scénario 1 est neuf et
  // hérite de la moyenne du run, la même. La longueur déclarée — 100 — ne sert
  // pas : on a mieux qu'une déclaration.
  assert.deepEqual(answerLengthsFor([0, 1], mesure, 100), [2000, 2000]);
});
```

Importer `measureRun`, `answerLengthsFor` et le type `EvalModels` en tête du fichier.

- [ ] **Step 2 : Le faire échouer**

```bash
cd web && node --test lib/extend.test.mts
```

Attendu : FAIL sur l'import si la tâche 3 n'est pas faite ; sinon PASS directement — auquel cas passer à l'étape 3, le test protégeant la composition que le câblage va utiliser.

- [ ] **Step 3 : Câbler dans `extendRun`**

Dans `web/lib/runs.ts`, ajouter aux imports :

```ts
import {
  answerLengthsFor,
  measureRun,
  type MeasurableCell,
} from "./measured-length";
```

Dans `extendRun`, juste avant le calcul de `ajout` (vers la ligne 380), lire les cases déjà jouées et les mesurer :

```ts
  // Ce que le run sait de lui-même. Quatre colonnes seulement : les
  // transcripts pèsent des centaines de kilo-octets et la mesure n'en a pas
  // besoin, `usage` portant les jetons réellement facturés.
  const jouees = await select<MeasurableCell>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: "scenario_index,target_model,status,usage",
  });
  for (const cell of jouees) cell.usage ??= {};
  const mesure = measureRun(jouees, config.models, config.turns);
```

Puis remplacer le calcul du devis d'ajout :

```ts
  // Le devis de l'ajout seul, puis additionné à celui du run : sans ça,
  // « devis vs réel » opposerait un coût qui a grandi à une estimation restée
  // sur la première matrice, et ne mesurerait plus l'estimation mais l'ajout.
  //
  // Il repose sur ce que le run a mesuré et non sur ce qu'il avait déclaré :
  // un scénario rejoué prend sa propre longueur, un scénario neuf celle du run
  // — on suppose alors qu'il ressemblera aux précédents, ce qui est faux dans
  // le détail et reste la meilleure information disponible.
  const ajoutes = indices
    .map((index) => scenarios[index])
    .filter((scenario) => Boolean(scenario));
  const ajout = estimateCost(
    {
      ...config,
      scenarios: ajoutes,
      models: { ...config.models, targets: request.targets },
      repetitions: request.repetitions,
      temperature,
    },
    {
      answer: answerLengthsFor(
        indices.filter((index) => Boolean(scenarios[index])),
        mesure,
        config.average_output_tokens,
      ),
      adversary: mesure.adversary,
    },
  );
```

Le filtre est le même des deux côtés, pour que la liste des longueurs reste alignée sur la liste des scénarios — un décalage donnerait à un scénario la longueur d'un autre, en silence.

- [ ] **Step 4 : Vérifier**

```bash
cd web && npm test 2>&1 | tail -20 && npx tsc --noEmit
```

Attendu : PASS.

- [ ] **Step 5 : Commit**

```bash
git add web/lib/runs.ts web/lib/extend.test.mts
git commit -m "feat: étendre un run l'estime sur ce qu'il a réellement consommé

Le run est terminé, ses jetons sont facturés et enregistrés : lui appliquer la
longueur déclarée avant qu'il tourne revenait à ignorer la seule donnée sûre
qu'on ait. Un scénario rejoué prend sa propre mesure, un scénario ajouté celle
du run."
```

---

## Task 5 : L'écran

**Files:**
- Modify: `web/app/api/estimate/route.ts:15-24`
- Modify: `web/lib/api.ts:215-226`
- Modify: `web/app/page.tsx:143-149, 387-…, 487-513, 700-711, 1310-1370`
- Modify: `web/components/ExtendPanel.tsx`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: rien pour d'autres tâches.

- [ ] **Step 1 : La route perd son paramètre**

`web/app/api/estimate/route.ts` — supprimer la lecture de `response_tokens` et l'argument :

```ts
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const config = (await request.json().catch(() => null)) as EvalRunConfig | null;

  const problem = configProblem(config);
  if (problem) return NextResponse.json({ error: problem }, { status: 422 });

  // La longueur supposée est dans la config, comme le reste : un paramètre de
  // requête à côté permettait d'estimer autre chose que ce qu'on s'apprêtait à
  // lancer.
  return NextResponse.json(estimateCost(config!));
}
```

Retirer l'import `new URL` devenu inutile s'il n'y en a pas d'autre usage.

- [ ] **Step 2 : Le client aussi**

`web/lib/api.ts` :

```ts
/** Estime un run. La longueur supposée voyage dans la config. */
export const estimateRun = (config: EvalRunConfig) =>
  request<CostEstimate>("/api/estimate", {
    method: "POST",
    body: JSON.stringify(config),
  });
```

- [ ] **Step 3 : Le formulaire**

Dans `web/app/page.tsx` :

Renommer l'état `responseTokens` en `averageOutputTokens` (ligne 149) et lui donner une valeur de départ tirée du partagé plutôt que `null` :

```ts
  const [averageOutputTokens, setAverageOutputTokens] = useState<number | null>(
    SHARED_PRICING.default_response_tokens,
  );
```

L'ajouter à ce que `config()` produit (vers la ligne 387) :

```ts
      average_output_tokens: averageOutputTokens ?? undefined,
```

Corriger l'appel et sa dépendance (lignes 492 et 513) : `estimateRun(config())` et `[ready, config]`.

Supprimer entièrement le bloc `assumedAverage` (lignes 700-711).

Remplacer le champ (lignes 1312-1352) :

```tsx
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span>Average output tokens:</span>
              <input
                type="number"
                min={1}
                max={100000}
                step={100}
                value={averageOutputTokens ?? ""}
                onChange={(e) =>
                  setAverageOutputTokens(
                    e.target.value.trim() === ""
                      ? null
                      : Math.max(1, Number(e.target.value) || 1),
                  )
                }
                className="w-28 rounded border border-zinc-300 p-1 text-right"
              />
              <span>per answer</span>
            </label>

            <p className="text-xs text-zinc-500">
              Everything the model produces on each call — reasoning included,
              not just the reply you read. A model that thinks before answering
              spends several times its visible answer, and that thinking is
              billed. It only feeds this estimate; it changes nothing about what
              the run does. Cost grows faster than the turn count, since every
              turn resends the whole history. Across the range this estimate can
              assume, the run sits between ${estimate.min_usd.toFixed(2)} and $
              {estimate.max_usd.toFixed(2)}. Anthropic cache writes, billed at
              1.25×, are not counted here.
            </p>
```

Pas de `placeholder` : il n'y a plus de moyenne à reconstituer. Un champ vide est un champ à remplir, et le devis disparaît en le disant.

Dans la colonne du tableau par modèle (ligne 1299), l'en-tête ou le libellé « tok/answer » devient « tok/turn » — ce n'est plus une propriété du modèle mais la longueur supposée des scénarios qu'il joue.

Enfin, le devis ne s'affiche plus quand le champ est vide : là où le composant rend `estimate &&`, ajouter le cas explicite plutôt qu'un panneau muet :

```tsx
{averageOutputTokens == null && (
  <p className="text-sm text-zinc-600">
    Fill in the average output tokens to see what this run would cost.
  </p>
)}
```

- [ ] **Step 4 : Le panneau d'extension**

Dans `web/components/ExtendPanel.tsx`, là où le devis de l'ajout s'affiche, annoncer la mesure au lieu de proposer une saisie. Le panneau reçoit déjà le run ; ajouter, sous le devis :

```tsx
{measured.run !== null ? (
  <p className="text-xs text-zinc-500">
    Priced on what this run actually spent — {measured.run.toLocaleString()}{" "}
    output tokens per turn, measured on {kept} cell{kept === 1 ? "" : "s"}
    {measured.skipped > 0 ? (
      <>
        . {measured.skipped} left out: their evaluated model was also the judge
        or the adversary, and the token counter cannot tell the two apart
      </>
    ) : null}
    .
  </p>
) : (
  <p className="text-xs text-zinc-500">
    Nothing measurable in this run yet — priced on the {" "}
    {(run.config.average_output_tokens ?? SHARED_PRICING.default_response_tokens).toLocaleString()}{" "}
    output tokens it assumed when it was composed.
  </p>
)}
```

`measured` et `kept` viennent de `measureRun`, que le panneau appelle lui-même.
Trois changements le lui permettent, tous nécessaires :

1. `web/lib/runs.ts:36` — ajouter `usage` à `SAMPLE_COLUMNS` :

```ts
const SAMPLE_COLUMNS =
  "id,run_id,scenario_index,scenario_title,target_model,repetition,status," +
  // `usage` porte les jetons facturés de la case. Petit — cinq compteurs par
  // modèle — et sans commune mesure avec les transcripts, qu'on continue de ne
  // ramener que sur demande. C'est ce qui permet au panneau d'extension
  // d'annoncer sur quoi son devis repose.
  "temperature,score,justification,error,started_at,finished_at,cost_usd,usage";
```

2. `web/app/eval/[runId]/page.tsx:728` — passer les cases au panneau :

```tsx
        <ExtendPanel
          samples={detail.samples}
```

3. `web/components/ExtendPanel.tsx` — accepter la prop et mesurer :

```tsx
export function ExtendPanel({
  run,
  samples,
  ...
}: {
  run: EvalRun;
  samples: EvalSample[];
  ...
}) {
  const config = run.config;
  // Sur quoi le devis de l'ajout va reposer. Recalculé ici pour l'annoncer :
  // le serveur fera la même mesure au moment d'étendre, à partir des mêmes
  // cases.
  const measured = measureRun(samples, config.models, config.turns);
```

`EvalSample` porte déjà les quatre champs de `MeasurableCell`, donc il passe
sans conversion.

- [ ] **Step 5 : Vérifier**

```bash
cd web && npm test 2>&1 | tail -20 && npx tsc --noEmit && npx eslint
```

Attendu : PASS, aucune erreur de type, aucun avertissement neuf.

- [ ] **Step 6 : Vérifier à l'œil**

```bash
scripts/dev.sh
```

Composer un run : le devis n'apparaît qu'une fois le champ rempli, et le tableau par modèle ne promet plus de longueur mesurée. Ouvrir un run terminé, cliquer « étendre » : le panneau annonce la longueur qu'il a mesurée, et le nombre de cases écartées s'il y en a.

- [ ] **Step 7 : Commit**

```bash
git add web/app/page.tsx web/lib/api.ts web/app/api/estimate/route.ts \
        web/components/ExtendPanel.tsx web/lib/measured-length.ts \
        web/lib/measured-length.test.mts
git commit -m "feat: l'écran demande la longueur de sortie au lieu de l'inventer

Le champ n'a plus de placeholder qui reconstituait une moyenne à partir d'une
table à trous : un champ vide est un champ à remplir, et le devis le dit. Le
panneau d'extension fait l'inverse — il n'y a rien à saisir, il annonce ce
qu'il a mesuré et combien de cases il a dû écarter."
```

---

## Vérification finale

- [ ] **La suite entière, des deux côtés**

```bash
pytest -q
cd web && npm test && npx tsc --noEmit && npx eslint
```

- [ ] **Plus une seule trace de la table**

```bash
grep -rn "output_tokens_per_call\|OUTPUT_TOKENS_PER_CALL\|responseTokensFor\|response_tokens_for" \
  --include="*.py" --include="*.ts" --include="*.tsx" --include="*.mts" --include="*.json" . \
  | grep -v node_modules
```

Attendu : aucune sortie.

- [ ] **Les deux estimateurs rendent le même devis**

Les suites des deux côtés couvrent les mêmes cas, mais rien ne vérifie qu'elles
rendent les mêmes *nombres*. Le faire une fois, à la main, sur la config de
`web/lib/pricing.test.mts` :

```bash
cd web && node -e '
import("./lib/pricing.ts").then(async (m) => {
  const { SHARED_PRICING } = await import("./lib/shared.ts");
  const s = { title: "T", system_prompt: "S".repeat(400), opening_message: "O".repeat(200) };
  const c = { scenarios: [s], criterion: "C".repeat(100),
    rubric: [{ value: 0, meaning: "R".repeat(40) }, { value: 1, meaning: "R".repeat(40) }],
    turns: 3, repetitions: 2,
    models: { targets: ["anthropic/claude-sonnet-5"], adversary: "anthropic/claude-haiku-4-5", judge: "openai/gpt-5.6-luna" },
    adversary_prompt: "A".repeat(200), average_output_tokens: 800 };
  console.log(m.estimateCost(c).usd);
});'
cd .. && python3 -c "
from playground.eval_schemas import EvalModels, EvalRunConfig, EvalScenario, RubricLevel
from playground.pricing import estimate_cost
s = EvalScenario(title='T', system_prompt='S'*400, opening_message='O'*200)
c = EvalRunConfig(scenarios=[s], criterion='C'*100,
    rubric=[RubricLevel(value=0, meaning='R'*40), RubricLevel(value=1, meaning='R'*40)],
    turns=3, repetitions=2,
    models=EvalModels(targets=['anthropic/claude-sonnet-5'], adversary='anthropic/claude-haiku-4-5', judge='openai/gpt-5.6-luna'),
    adversary_prompt='A'*200, average_output_tokens=800)
print(estimate_cost(c).usd)"
```

Les deux nombres doivent être identiques. S'ils divergent, c'est une
régression : les jumeaux sont la garantie que le devis affiché avant un run est
celui qui sera enregistré avec lui.
