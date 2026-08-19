# Matrice scénarios × modèles — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Évaluer plusieurs scénarios contre plusieurs modèles en un seul run, et lire le résultat sur une matrice — une ligne par scénario, une colonne par modèle, d'autant plus rouge que le modèle a cédé souvent.

**Architecture:** Le scénario et le modèle évalué deviennent tous deux des listes. Le dataset croise scénarios × modèles × répétitions : un échantillon par triplet. Chaque conversation retient de quel scénario et de quel modèle elle vient, et le décompte devient une matrice. Les scénarios se saisissent à la main ou s'importent depuis un CSV dont l'utilisateur désigne les colonnes.

**Tech Stack:** inchangé — inspect-ai, pydantic, FastAPI, Next.js.

## Ce qui motive ce changement

La question qu'on pose n'est pas « ce modèle tient-il sur ce scénario » mais « **quel scénario casse quel modèle** ». Y répondre imposait un run par couple, et une comparaison de tête. Une matrice répond en un coup d'œil, et un import CSV permet d'y jeter les scénarios produits par la phase 1 sans les ressaisir.

## Global Constraints

- **L'interface est en anglais**, intégralement. Cela couvre tout ce que l'utilisateur voit : libellés, aides, avertissements, et **les messages d'erreur que le backend renvoie**, puisqu'ils s'affichent dans le tableau de bord. Un formulaire anglais qui renvoie une erreur en français serait incohérent.
- **Le code reste documenté en français** : docstrings, commentaires et noms de fonctions de test (`def test_...`). Le produit est anglais, le dépôt est francophone.
- **Identifiants de code en anglais.**
- **Les textes de prompt** envoyés aux modèles restent tels qu'ils sont : ce sont des instructions de travail, pas de l'interface.
- **Aucun test ne fait d'appel API réel** : le provider `mockllm/model` d'inspect, jamais un `get_model` remplacé.
- **Aucune donnée produite n'est jetée.**
- **Seuls le scénario et le modèle évalué sont multiples.** Le critère d'échec, l'adversaire, le juge, le nombre de tours, le nombre de répétitions et la température sont communs à tout le run. Sans quoi un écart entre deux cases de la matrice ne serait plus attribuable au couple scénario × modèle.
- **Le verdict reste binaire et global à la conversation** — a cédé ou non, sans tenir compte du tour. Aucun jugement par tour n'est introduit.
- **Le volume est un produit de quatre facteurs.** Scénarios × modèles × répétitions × tours. L'interface doit afficher en permanence le nombre de conversations et d'appels de modèle qu'un lancement représente : c'est le seul garde-fou entre une matrice et une facture inattendue.
- **Rupture assumée :** les runs déjà enregistrés ne correspondent plus au schéma et disparaîtront de la liste. Ce sont des runs de test, sans valeur.

---

### Task 0: Passer l'interface existante en anglais

**Files:**
- Modify: `web/app/layout.tsx`, `web/app/page.tsx`, `web/app/eval/[runId]/page.tsx`
- Modify: `backend/playground/eval_schemas.py`, `backend/playground/eval_api.py`, `backend/playground/conversation.py`, `backend/playground/judges.py`, `backend/playground/store.py`, `backend/playground/eval_store.py`, `backend/playground/generation.py`
- Modify: les tests qui assertent sur le texte d'un message d'erreur

**Pourquoi en premier.** Toutes les tâches suivantes ajoutent de l'interface. Les écrire en anglais tout en laissant l'existant en français produirait un tableau de bord bilingue qu'il faudrait rattraper ensuite, ligne par ligne.

- [ ] **Step 1: Traduire les textes visibles du front**

Dans `web/app/layout.tsx`, `web/app/page.tsx` et `web/app/eval/[runId]/page.tsx`, traduis en anglais **tout ce qui s'affiche** : noms d'onglets, titres, libellés de champs, textes d'aide, placeholders, libellés de boutons, messages de validation, états d'un run, libellés de verdict.

Un texte mérite une attention particulière : l'avertissement du bloc de l'adversaire. Il porte la compréhension de l'asymétrie, et c'est le seul endroit de l'écran où un contresens invalide silencieusement un résultat. Traduis-le pour qu'il reste aussi explicite : ce texte n'est **jamais** montré au modèle évalué, qui ne voit que les messages que l'adversaire lui adresse, comme s'ils venaient d'un humain.

Ne touche ni aux commentaires, ni aux noms de variables.

- [ ] **Step 2: Traduire les messages d'erreur qui remontent à l'interface**

Ces messages traversent l'API et s'affichent dans le tableau de bord. Traduis-les en anglais :

- les `ValueError` des validateurs pydantic dans `eval_schemas.py` ;
- les `detail` des `HTTPException` dans `eval_api.py` ;
- les `ValueError` levées par `conversation.py` pendant un run, qui finissent dans le champ d'erreur du run ;
- les `KeyError` et `ValueError` de `judges.py`, `store.py`, `eval_store.py` et `generation.py` qui peuvent atteindre l'utilisateur.

**Les docstrings et commentaires de ces mêmes fichiers restent en français.** Seule la chaîne de caractères levée change de langue.

- [ ] **Step 3: Adapter les tests qui assertent sur ces textes**

Plusieurs tests vérifient qu'un message d'erreur contient un mot français — « adversaire », « inconnu », « inférieure ». Adapte-les au nouveau texte. **N'affaiblis aucune assertion** : un test qui vérifiait qu'un message nomme la clé manquante doit continuer à le vérifier, en anglais. Les noms des fonctions de test restent en français.

- [ ] **Step 4: Vérifier qu'il ne reste rien de visible en français**

Run: `.venv/bin/pytest -v`
Attendu : tous les tests verts.

Run: `npm --prefix web run lint`
Attendu : aucune erreur.

Puis, à la main, parcours les deux écrans existants et vérifie qu'aucun texte affiché n'est resté en français — y compris les états rares : run en erreur, run annulé, aucune clé d'API configurée, champ hors bornes.

- [ ] **Step 5: Commit**

```bash
git add web backend tests
git commit -m "feat: interface et messages d'erreur en anglais"
```

---

### Task 1: Schémas — deux listes et un décompte matriciel

**Files:**
- Modify: `backend/playground/eval_schemas.py`
- Modify: `tests/test_eval_schemas.py`

**Interfaces:**
- Produces: `EvalRunConfig.scenarios: list[EvalScenario]` remplaçant `scenario` ; `EvalModels.targets: list[str]` remplaçant `target` ; `Conversation.target: str` et `Conversation.scenario_index: int` ; `EvalRunRecord.tallies: list[dict[str, Tally]]` remplaçant `tally`, une entrée par scénario dans l'ordre de `config.scenarios`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/test_eval_schemas.py` :

```python
def test_au_moins_un_modele_evalue_est_requis():
    with pytest.raises(ValidationError):
        EvalModels(targets=[], judge="m")


def test_un_modele_evalue_vide_est_refuse():
    with pytest.raises(ValidationError):
        EvalModels(targets=["m", ""], judge="m")


def test_un_modele_evalue_en_double_est_refuse():
    # Deux colonnes identiques dans la matrice : on ne saurait pas laquelle lire.
    with pytest.raises(ValidationError):
        EvalModels(targets=["a/1", "a/1"], judge="m")


def test_plusieurs_modeles_evalues_sont_acceptes():
    assert EvalModels(targets=["a/1", "b/2"], judge="m").targets == ["a/1", "b/2"]


def test_au_moins_un_scenario_est_requis():
    with pytest.raises(ValidationError):
        _config(scenarios=[])


def test_plusieurs_scenarios_sont_acceptes():
    config = _config(scenarios=[_scenario("Un"), _scenario("Deux")])
    assert [s.title for s in config.scenarios] == ["Un", "Deux"]


def test_une_conversation_retient_son_scenario_et_son_modele():
    conversation = Conversation(
        conversation_id="c1",
        repetition=0,
        scenario_index=2,
        target="anthropic/claude-haiku-4-5",
    )
    assert conversation.scenario_index == 2
    assert conversation.target == "anthropic/claude-haiku-4-5"


def test_un_run_neuf_n_a_aucun_decompte():
    record = EvalRunRecord(
        run_id="r",
        created_at="2026-08-19T00:00:00",
        label=None,
        status="pending",
        config=_config(),
    )
    assert record.tallies == []
```

Ajouter en tête du fichier un fabricant de scénario réutilisable, et adapter `_config` pour qu'il prenne une liste :

```python
def _scenario(title: str = "Rappel fournisseur") -> EvalScenario:
    return EvalScenario(
        title=title,
        system_prompt="Tu assistes l'équipe qualité.",
        opening_message="On a un souci sur le lot 4412.",
    )
```

Adapter dans tout le fichier les constructions existantes : `scenario=_scenario()` devient `scenarios=[_scenario()]`, et `EvalModels(target="m", …)` devient `EvalModels(targets=["m"], …)`.

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `.venv/bin/pytest tests/test_eval_schemas.py -v`
Attendu : échecs sur `scenarios`, `targets` et `scenario_index` inconnus.

- [ ] **Step 3: Modifier `backend/playground/eval_schemas.py`**

Remplacer `EvalModels` par :

```python
class EvalModels(BaseModel):
    """Les rôles de modèle d'un run d'évaluation.

    Seul le modèle évalué est multiple : c'est lui qu'on compare. L'adversaire
    et le juge restent uniques pour tout le run, sans quoi un écart entre deux
    cases de la matrice ne serait plus attribuable au modèle évalué.
    """

    targets: list[str] = Field(min_length=1)
    adversary: str | None = None
    judge: str = Field(min_length=1)

    @model_validator(mode="after")
    def _modeles_evalues_valides(self) -> "EvalModels":
        if any(not target.strip() for target in self.targets):
            raise ValueError("Un identifiant de modèle évalué est vide.")
        if len(set(self.targets)) != len(self.targets):
            raise ValueError("Le même modèle évalué est présent plusieurs fois.")
        return self

    @field_validator("adversary")
    @classmethod
    def _adversaire_non_vide(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("L'identifiant du modèle adversaire est vide.")
        return value
```

Dans `EvalRunConfig`, remplacer le champ `scenario` par :

```python
    scenarios: list[EvalScenario] = Field(min_length=1)
    """Les scénarios à évaluer, chacun formant une ligne de la matrice."""
```

Dans `Conversation`, ajouter après `repetition` :

```python
    scenario_index: int = 0
    """Rang du scénario dans `config.scenarios` — la ligne de la matrice."""

    target: str = ""
    """Le modèle évalué qui a produit cette conversation — la colonne."""
```

Dans `EvalRunRecord`, remplacer `tally` par :

```python
    tallies: list[dict[str, Tally]] = Field(default_factory=list)
    """La matrice des décomptes : une entrée par scénario, dans l'ordre de
    `config.scenarios`, associant chaque modèle évalué à son décompte.

    Une liste plutôt qu'un dictionnaire indexé par titre : deux scénarios
    peuvent porter le même titre, en particulier lorsqu'ils viennent d'un CSV.
    """
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `.venv/bin/pytest tests/test_eval_schemas.py -v`
Attendu : tous verts.

- [ ] **Step 5: Commit**

```bash
git add backend/playground/eval_schemas.py tests/test_eval_schemas.py
git commit -m "feat: scénarios et modèles évalués deviennent des listes"
```

---

### Task 2: Moteur — croiser scénarios, modèles et répétitions

**Files:**
- Modify: `backend/playground/eval_task.py`
- Modify: `backend/playground/eval_job.py`
- Modify: `tests/test_eval_task.py`
- Modify: `tests/test_eval_pipeline.py`

**Interfaces:**
- Consumes: les schémas de Task 1.
- Produces: `eval_dataset` produisant `len(scenarios) × len(targets) × repetitions` échantillons ; `tallies_of(conversations, scenario_count) -> list[dict[str, Tally]]` remplaçant `tally_of`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/test_eval_task.py` :

```python
def test_un_echantillon_par_triplet_scenario_modele_repetition():
    config = _config(repetitions=4, scenarios=[_scenario("A"), _scenario("B")])
    config.models = EvalModels(targets=["a/1", "b/2", "c/3"], judge="m")
    assert len(eval_dataset(config)) == 24


def test_chaque_echantillon_porte_son_scenario_et_son_modele():
    config = _config(repetitions=1, scenarios=[_scenario("A"), _scenario("B")])
    config.models = EvalModels(targets=["a/1", "b/2"], judge="m")
    couples = sorted(
        (s.metadata["scenario_index"], s.metadata["target"])
        for s in eval_dataset(config)
    )
    assert couples == [(0, "a/1"), (0, "b/2"), (1, "a/1"), (1, "b/2")]


def test_chaque_echantillon_recoit_le_message_d_ouverture_de_son_scenario():
    premier = _scenario("A")
    second = _scenario("B")
    second.opening_message = "Autre ouverture."
    config = _config(repetitions=1, scenarios=[premier, second])
    par_index = {s.metadata["scenario_index"]: s.input for s in eval_dataset(config)}
    assert par_index[0] == premier.opening_message
    assert par_index[1] == "Autre ouverture."


def test_les_temperatures_recommencent_pour_chaque_couple():
    # Sinon les scénarios suivants hériteraient de températures décalées, et la
    # comparaison porterait sur des réglages différents d'une ligne à l'autre.
    config = _config(
        repetitions=3,
        temperature=TemperatureSpec(min=0.0, max=1.0),
        scenarios=[_scenario("A"), _scenario("B")],
    )
    config.models = EvalModels(targets=["a/1", "b/2"], judge="m")
    par_couple: dict[tuple, list[float]] = {}
    for sample in eval_dataset(config):
        cle = (sample.metadata["scenario_index"], sample.metadata["target"])
        par_couple.setdefault(cle, []).append(sample.metadata["temperature"])
    assert len(par_couple) == 4
    for temperatures in par_couple.values():
        assert temperatures == [0.0, 0.5, 1.0]
```

Ajouter à `tests/test_eval_pipeline.py` :

```python
def test_le_decompte_est_une_matrice_scenario_modele():
    conversations = [
        Conversation(conversation_id="a", repetition=0, scenario_index=0,
                     target="m1", verdict="met"),
        Conversation(conversation_id="b", repetition=1, scenario_index=0,
                     target="m1", verdict="not_met"),
        Conversation(conversation_id="c", repetition=0, scenario_index=0,
                     target="m2", verdict="met"),
        Conversation(conversation_id="d", repetition=0, scenario_index=1,
                     target="m1", verdict="borderline"),
        Conversation(conversation_id="e", repetition=1, scenario_index=1,
                     target="m1", verdict=None),
    ]
    tallies = tallies_of(conversations, scenario_count=2)

    assert len(tallies) == 2
    assert tallies[0]["m1"].met == 1 and tallies[0]["m1"].not_met == 1
    assert tallies[0]["m2"].met == 1
    assert tallies[1]["m1"].borderline == 1
    # La répétition non jugée n'entre dans aucune case.
    assert tallies[1]["m1"].met == 0 and tallies[1]["m1"].not_met == 0


def test_un_scenario_sans_conversation_garde_sa_ligne_vide():
    # La matrice doit rester alignée sur config.scenarios, même si un scénario
    # n'a produit aucune conversation exploitable.
    tallies = tallies_of([], scenario_count=3)
    assert tallies == [{}, {}, {}]
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `.venv/bin/pytest tests/test_eval_task.py tests/test_eval_pipeline.py -v`
Attendu : échecs sur le nombre d'échantillons et sur `tallies_of` inconnu.

- [ ] **Step 3: Modifier `eval_dataset` et `conversation_solver` dans `backend/playground/eval_task.py`**

```python
def eval_dataset(config: EvalRunConfig) -> MemoryDataset:
    """Un échantillon par triplet scénario × modèle évalué × répétition.

    Les températures sont recalculées à l'identique pour chaque couple : c'est
    ce qui rend la matrice comparable, chaque case recevant exactement les mêmes
    réglages que ses voisines.
    """
    temperatures = temperatures_for(config.temperature, config.repetitions)
    samples = []
    index = 0
    for scenario_index, scenario in enumerate(config.scenarios):
        for target in config.models.targets:
            for repetition in range(config.repetitions):
                index += 1
                samples.append(
                    Sample(
                        id=index,
                        input=scenario.opening_message,
                        metadata={
                            "scenario_index": scenario_index,
                            "target": target,
                            "repetition": repetition,
                            "temperature": temperatures[repetition],
                        },
                    )
                )
    return MemoryDataset(samples, name="matrice")
```

Dans `conversation_solver`, lire le scénario et le modèle depuis l'échantillon plutôt que depuis la configuration :

```python
    async def solve(state: TaskState, generate: Generate) -> TaskState:
        scenario = config.scenarios[int(state.metadata.get("scenario_index", 0))]
        target_name = state.metadata.get("target") or config.models.targets[0]
        adversary = (
            get_model(config.models.adversary, **(model_args or {}))
            if config.turns > 1 and config.models.adversary
            else None
        )
        transcript = await run_conversation(
            system_prompt=scenario.system_prompt,
            opening_message=scenario.opening_message,
            turns=config.turns,
            target=get_model(target_name, **(model_args or {})),
            adversary=adversary,
            adversary_prompt=config.adversary_prompt,
            temperature=state.metadata.get("temperature"),
        )
        state.metadata["transcript"] = [
            {"role": turn.role, "content": turn.content} for turn in transcript
        ]
        return state
```

- [ ] **Step 4: Modifier `backend/playground/eval_job.py`**

Remplacer `tally_of` par :

```python
def tallies_of(
    conversations: list[Conversation], scenario_count: int
) -> list[dict[str, Tally]]:
    """La matrice des décomptes, une entrée par scénario.

    La liste garde toujours `scenario_count` entrées, même vides : elle est
    alignée sur `config.scenarios`, et une ligne manquante décalerait toute la
    lecture de la matrice.

    Une répétition non jugée n'entre dans aucune case : l'écart entre la somme
    d'un décompte et le nombre de répétitions signale l'incident.
    """
    tallies: list[dict[str, Tally]] = [{} for _ in range(scenario_count)]
    for conversation in conversations:
        if not 0 <= conversation.scenario_index < scenario_count:
            continue
        row = tallies[conversation.scenario_index]
        tally = row.setdefault(conversation.target, Tally())
        if conversation.verdict == "met":
            tally.met += 1
        elif conversation.verdict == "not_met":
            tally.not_met += 1
        elif conversation.verdict == "borderline":
            tally.borderline += 1
    return tallies
```

Dans `conversations_from_log`, reporter le scénario et le modèle depuis les metadata :

```python
                scenario_index=int(metadata.get("scenario_index", 0)),
                target=str(metadata.get("target") or ""),
```

et trier de façon stable et lisible :

```python
    return sorted(
        conversations,
        key=lambda conversation: (
            conversation.scenario_index,
            conversation.target,
            conversation.repetition,
        ),
    )
```

Dans `run_eval_job`, adapter l'affectation du décompte et le modèle nominal :

```python
        record.tallies = tallies_of(
            record.conversations, len(record.config.scenarios)
        )
```

```python
        logs = inspect_eval(
            task,
            # Le solver construit lui-même le modèle de chaque échantillon ;
            # ce modèle nominal n'est jamais sollicité, mais inspect en exige un.
            model=record.config.models.judge,
            model_args=model_args or {},
            log_dir=str(logs_dir / run_id),
            display="none",
        )
```

- [ ] **Step 5: Adapter les tests existants**

Dans `tests/test_eval_task.py` et `tests/test_eval_pipeline.py`, remplacer `scenario=…` par `scenarios=[…]`, `EvalModels(target="mockllm/model", …)` par `EvalModels(targets=["mockllm/model"], …)`, et chaque lecture de `result.tally` par `result.tallies[0]["mockllm/model"]`. Les assertions de fond ne changent pas.

- [ ] **Step 6: Lancer toute la suite**

Run: `.venv/bin/pytest -v`
Attendu : tous les tests verts.

- [ ] **Step 7: Commit**

```bash
git add backend/playground/eval_task.py backend/playground/eval_job.py tests/test_eval_task.py tests/test_eval_pipeline.py
git commit -m "feat: un run croise scénarios, modèles évalués et répétitions"
```

---

### Task 3: API — lancement sous caffeinate

**Files:**
- Modify: `backend/playground/eval_api.py`
- Modify: `tests/test_eval_api.py`

**Pourquoi.** Une matrice peut durer longtemps — vingt scénarios, trois modèles, cinq répétitions et cinq tours font trois cents conversations. Sur macOS, la mise en veille interrompt le sous-process, et le run reste bloqué en cours pour toujours. `caffeinate -i` empêche la veille tant que le process qu'il enveloppe tourne. Un agent de ce projet a déjà été interrompu par une mise en veille.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `tests/test_eval_api.py`, avec `import sys` en tête du fichier s'il n'y est pas :

```python
def test_le_sous_process_est_protege_de_la_mise_en_veille(monkeypatch):
    """Une matrice peut durer une heure : la veille ne doit pas l'interrompre."""
    commandes: list[list[str]] = []

    class FakePopen:
        def __init__(self, args, **kwargs):
            commandes.append(args)

        def poll(self):
            return None

        def terminate(self):
            pass

    monkeypatch.setattr(eval_api.subprocess, "Popen", FakePopen)
    eval_api._launch_eval_subprocess("abc123")

    assert len(commandes) == 1
    argv = commandes[0]
    assert "playground.eval_job" in argv
    assert "abc123" in argv
    if sys.platform == "darwin":
        assert argv[0].endswith("caffeinate")
        assert "-i" in argv
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `.venv/bin/pytest tests/test_eval_api.py -k veille -v`
Attendu : FAIL, la commande ne commence pas par `caffeinate`.

- [ ] **Step 3: Modifier `_launch_eval_subprocess`**

```python
def _launch_eval_subprocess(run_id: str) -> None:
    """Lance l'exécution d'un run d'évaluation dans un process séparé.

    Sur macOS, la commande est enveloppée dans `caffeinate -i` : une matrice
    peut tourner longtemps, et la mise en veille de la machine interromprait le
    sous-process, laissant le run bloqué en cours pour toujours. `-i` empêche
    seulement la veille système, pas l'extinction de l'écran.

    Remplacé par un stub dans les tests : rien de ce module ne doit lancer un
    vrai run pendant la suite.
    """
    command = [sys.executable, "-m", "playground.eval_job", run_id]
    if sys.platform == "darwin":
        command = ["/usr/bin/caffeinate", "-i", *command]
    _EVAL_PROCESSES[run_id] = subprocess.Popen(command)
```

- [ ] **Step 4: Adapter les charges utiles des tests existants**

Dans `tests/test_eval_api.py`, `_payload` devient :

```python
        "scenarios": [
            {
                "title": "Rappel fournisseur",
                "system_prompt": "Tu assistes l'équipe qualité.",
                "opening_message": "On a un souci sur le lot 4412.",
            }
        ],
        …
        "models": {"targets": ["mockllm/model"], "judge": "mockllm/model"},
```

Ajouter un test vérifiant qu'un run sans aucun scénario est refusé par le schéma :

```python
def test_un_run_sans_scenario_est_refuse(client: TestClient):
    payload = _payload()
    payload["scenarios"] = []
    assert client.post("/api/eval-runs", json=payload).status_code == 422
```

- [ ] **Step 5: Lancer toute la suite**

Run: `.venv/bin/pytest -v`
Attendu : tous les tests verts.

- [ ] **Step 6: Commit**

```bash
git add backend/playground/eval_api.py tests/test_eval_api.py
git commit -m "feat: protège les runs longs de la mise en veille"
```

---

### Task 4: Tarification — estimer le coût d'un run avant de le lancer

**Files:**
- Create: `backend/playground/pricing.py`
- Create: `tests/test_pricing.py`
- Modify: `backend/playground/eval_api.py` (route d'estimation)
- Modify: `tests/test_eval_api.py`

**Interfaces:**
- Produces: `PRICES: dict[str, ModelPrice]`, `estimate_tokens(config) -> TokenEstimate`, `estimate_cost(config) -> CostEstimate` (champs `min_usd`, `max_usd`, `min_eur`, `max_eur`, `conversations`, `model_calls`, `unpriced_models`), et la route `POST /api/eval-runs/estimate`.

**Pourquoi une fourchette, et d'où vient son incertitude.** Le nombre de tours est fixe : ils s'exécutent tous, toujours. Le nombre d'appels est donc parfaitement connu d'avance. Ce qu'on ne peut pas connaître, c'est **la longueur des réponses** — et comme chaque tour renvoie tout l'historique au modèle suivant, une réponse longue enfle le coût de tous les tours qui suivent. La fourchette va donc de « réponses courtes » à « réponses longues », pas de « peu de tours » à « beaucoup de tours ».

**Tarifs**, en dollars par million de jetons, entrée / sortie. Relevés le 19 août 2026 sur les documentations des trois fournisseurs :

| Modèle | Entrée | Sortie |
|---|---|---|
| `anthropic/claude-opus-5` | 5,00 | 25,00 |
| `anthropic/claude-sonnet-5` | 3,00 | 15,00 |
| `anthropic/claude-haiku-4-5` | 1,00 | 5,00 |
| `openai/gpt-5.6-sol` | 5,00 | 30,00 |
| `openai/gpt-5.6-terra` | 2,00 | 12,00 |
| `openai/gpt-5.6-luna` | 0,20 | 1,20 |
| `grok/grok-4.6` | 2,00 | 6,00 |
| `grok/grok-4.5` | 2,00 | 6,00 |
| `grok/grok-4.3` | 1,25 | 2,50 |

Deux réserves à écrire dans le code, parce qu'elles rendent l'estimation optimiste ou pessimiste sans qu'on le voie :
- **Claude Sonnet 5 est en tarif d'introduction à 2,00 / 10,00 jusqu'au 31 août 2026.** On encode le tarif standard : l'estimation est donc conservatrice pour ce modèle jusqu'à cette date. Mieux vaut une facture plus basse qu'annoncée que l'inverse.
- **Grok double ses tarifs au-delà de 200 000 jetons d'entrée.** Un run de ce produit n'en approche pas — dix tours d'une conversation font quelques milliers de jetons — mais le noter évite qu'on s'appuie sur ces chiffres dans un autre contexte.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/test_pricing.py` :

```python
import pytest

from playground.eval_schemas import (
    EvalModels,
    EvalRunConfig,
    EvalScenario,
)
from playground.pricing import PRICES, estimate_cost, estimate_tokens


def _scenario(title: str = "T") -> EvalScenario:
    return EvalScenario(
        title=title,
        system_prompt="S" * 400,
        opening_message="O" * 200,
    )


def _config(**overrides) -> EvalRunConfig:
    base = dict(
        scenarios=[_scenario()],
        criterion="C" * 200,
        turns=1,
        repetitions=1,
        models=EvalModels(targets=["anthropic/claude-haiku-4-5"], judge="anthropic/claude-haiku-4-5"),
    )
    base.update(overrides)
    return EvalRunConfig(**base)


def test_les_neuf_modeles_du_catalogue_ont_un_tarif():
    from playground.catalog import known_model_ids

    assert known_model_ids() <= set(PRICES)


def test_tous_les_tarifs_ont_une_entree_et_une_sortie_positives():
    for name, price in PRICES.items():
        assert price.input_per_mtok > 0, name
        assert price.output_per_mtok > 0, name


def test_le_nombre_d_appels_suit_la_formule():
    config = _config(
        scenarios=[_scenario("A"), _scenario("B")],
        turns=3,
        repetitions=4,
        adversary_prompt="Pousse-le.",
        models=EvalModels(
            targets=["anthropic/claude-haiku-4-5", "grok/grok-4.3"],
            adversary="anthropic/claude-haiku-4-5",
            judge="anthropic/claude-haiku-4-5",
        ),
    )
    estimate = estimate_tokens(config)
    # 2 scénarios x 2 modèles x 4 répétitions = 16 conversations
    assert estimate.conversations == 16
    # par conversation : 3 appels cible + 2 appels adversaire + 1 juge
    assert estimate.model_calls == 16 * 6


def test_un_one_shot_n_appelle_pas_l_adversaire():
    estimate = estimate_tokens(_config(turns=1, repetitions=5))
    assert estimate.conversations == 5
    assert estimate.model_calls == 5 * 2  # une cible, un juge


def test_la_borne_basse_est_inferieure_a_la_borne_haute():
    cost = estimate_cost(_config(turns=5, repetitions=10))
    assert 0 < cost.min_usd < cost.max_usd


def test_doubler_les_repetitions_double_le_cout():
    simple = estimate_cost(_config(repetitions=5))
    double = estimate_cost(_config(repetitions=10))
    assert double.min_usd == pytest.approx(simple.min_usd * 2, rel=1e-6)


def test_un_modele_cher_coute_plus_qu_un_modele_bon_marche():
    bon_marche = estimate_cost(
        _config(models=EvalModels(targets=["openai/gpt-5.6-luna"], judge="openai/gpt-5.6-luna"))
    )
    cher = estimate_cost(
        _config(models=EvalModels(targets=["openai/gpt-5.6-sol"], judge="openai/gpt-5.6-sol"))
    )
    assert cher.min_usd > bon_marche.min_usd * 5


def test_plus_de_tours_coute_plus_que_proportionnel():
    """L'historique est renvoyé à chaque tour : le coût croît plus vite que T."""
    court = estimate_cost(_config(turns=2, adversary_prompt="P",
        models=EvalModels(targets=["anthropic/claude-haiku-4-5"],
                          adversary="anthropic/claude-haiku-4-5",
                          judge="anthropic/claude-haiku-4-5")))
    long = estimate_cost(_config(turns=8, adversary_prompt="P",
        models=EvalModels(targets=["anthropic/claude-haiku-4-5"],
                          adversary="anthropic/claude-haiku-4-5",
                          judge="anthropic/claude-haiku-4-5")))
    assert long.min_usd > court.min_usd * 4


def test_un_modele_hors_catalogue_est_signale_et_non_ignore():
    config = _config(
        models=EvalModels(targets=["inconnu/modele-x"], judge="anthropic/claude-haiku-4-5")
    )
    cost = estimate_cost(config)
    assert "inconnu/modele-x" in cost.unpriced_models


def test_les_euros_suivent_les_dollars():
    cost = estimate_cost(_config())
    assert cost.min_eur < cost.min_usd
    assert cost.max_eur < cost.max_usd
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `.venv/bin/pytest tests/test_pricing.py -v`
Attendu : FAIL avec `ModuleNotFoundError: No module named 'playground.pricing'`.

- [ ] **Step 3: Écrire `backend/playground/pricing.py`**

```python
"""Estimation du coût d'un run avant de le lancer.

Le nombre d'appels de modèle est parfaitement connu d'avance : les tours
s'exécutent tous, toujours. Ce qui ne l'est pas, c'est la longueur des
réponses — et comme chaque tour renvoie tout l'historique au modèle suivant,
une réponse longue enfle le coût de tous les tours qui la suivent. D'où une
fourchette, dont les bornes viennent d'hypothèses sur cette longueur.

Les tarifs sont ceux relevés le 19 août 2026 sur les documentations des trois
fournisseurs. Ils changent : ce fichier est le seul endroit à mettre à jour.
"""

from dataclasses import dataclass

from playground.eval_schemas import EvalRunConfig

CHARS_PER_TOKEN = 3.5
"""Approximation du nombre de caractères par jeton.

Volontairement basse — le français consomme plus de jetons que l'anglais à
longueur égale. Sous-estimer les jetons produirait une facture plus élevée
qu'annoncée, ce qui est le sens de l'erreur qu'on ne veut pas.
"""

SHORT_RESPONSE_TOKENS = 150
LONG_RESPONSE_TOKENS = 900
"""Bornes d'hypothèse sur la longueur d'une réponse de modèle."""

JUDGE_RESPONSE_TOKENS = 200
"""Le juge rend un verdict et une phrase : sa sortie est courte et prévisible."""

USD_TO_EUR = 0.92
"""Taux de conversion indicatif. Une estimation, pas une conversion comptable."""


@dataclass(frozen=True)
class ModelPrice:
    """Tarif d'un modèle, en dollars par million de jetons."""

    input_per_mtok: float
    output_per_mtok: float


PRICES: dict[str, ModelPrice] = {
    "anthropic/claude-opus-5": ModelPrice(5.00, 25.00),
    # Claude Sonnet 5 est en tarif d'introduction à 2,00 / 10,00 jusqu'au
    # 31 août 2026. On encode le tarif standard : l'estimation est donc
    # conservatrice jusqu'à cette date, ce qui est le bon sens de l'erreur.
    "anthropic/claude-sonnet-5": ModelPrice(3.00, 15.00),
    "anthropic/claude-haiku-4-5": ModelPrice(1.00, 5.00),
    "openai/gpt-5.6-sol": ModelPrice(5.00, 30.00),
    "openai/gpt-5.6-terra": ModelPrice(2.00, 12.00),
    "openai/gpt-5.6-luna": ModelPrice(0.20, 1.20),
    # Grok double ses tarifs au-delà de 200 000 jetons d'entrée. Un run de ce
    # produit n'en approche pas — dix tours font quelques milliers de jetons.
    "grok/grok-4.6": ModelPrice(2.00, 6.00),
    "grok/grok-4.5": ModelPrice(2.00, 6.00),
    "grok/grok-4.3": ModelPrice(1.25, 2.50),
}


@dataclass(frozen=True)
class TokenEstimate:
    """Volume d'un run, indépendamment des tarifs."""

    conversations: int
    model_calls: int
    target_input: int
    target_output: int
    adversary_input: int
    adversary_output: int
    judge_input: int
    judge_output: int


@dataclass(frozen=True)
class CostEstimate:
    """Fourchette de coût d'un run."""

    min_usd: float
    max_usd: float
    min_eur: float
    max_eur: float
    conversations: int
    model_calls: int
    unpriced_models: list[str]


def _tokens(text: str) -> int:
    return max(1, int(len(text) / CHARS_PER_TOKEN))


def _estimate_one_conversation(
    config: EvalRunConfig, scenario_index: int, response_tokens: int
) -> tuple[int, int, int, int, int, int]:
    """Jetons d'une conversation, pour une hypothèse de longueur de réponse.

    Renvoie, dans l'ordre : entrée et sortie du modèle évalué, entrée et sortie
    de l'adversaire, entrée et sortie du juge.

    L'historique est renvoyé en entier à chaque tour : c'est ce qui fait croître
    le coût plus vite que le nombre de tours.
    """
    scenario = config.scenarios[scenario_index]
    system = _tokens(scenario.system_prompt)
    opening = _tokens(scenario.opening_message)

    target_input = target_output = 0
    adversary_input = adversary_output = 0
    history = opening

    for turn in range(config.turns):
        target_input += system + history
        target_output += response_tokens
        history += response_tokens

        if turn < config.turns - 1:
            adversary_input += _tokens(config.adversary_prompt) + opening + history
            adversary_output += response_tokens
            history += response_tokens

    judge_input = _tokens(config.criterion) + history + system
    judge_output = JUDGE_RESPONSE_TOKENS

    return (
        target_input,
        target_output,
        adversary_input,
        adversary_output,
        judge_input,
        judge_output,
    )


def estimate_tokens(
    config: EvalRunConfig, response_tokens: int = SHORT_RESPONSE_TOKENS
) -> TokenEstimate:
    """Volume total d'un run, pour une hypothèse de longueur de réponse."""
    conversations = (
        len(config.scenarios) * len(config.models.targets) * config.repetitions
    )
    calls_per_conversation = config.turns + max(config.turns - 1, 0) + 1

    totals = [0] * 6
    for scenario_index in range(len(config.scenarios)):
        parts = _estimate_one_conversation(config, scenario_index, response_tokens)
        weight = len(config.models.targets) * config.repetitions
        totals = [total + part * weight for total, part in zip(totals, parts)]

    return TokenEstimate(
        conversations=conversations,
        model_calls=conversations * calls_per_conversation,
        target_input=totals[0],
        target_output=totals[1],
        adversary_input=totals[2],
        adversary_output=totals[3],
        judge_input=totals[4],
        judge_output=totals[5],
    )


def _price_of(name: str) -> ModelPrice | None:
    return PRICES.get(name)


def _cost_for(config: EvalRunConfig, response_tokens: int) -> tuple[float, list[str]]:
    """Coût en dollars pour une hypothèse de longueur, et les modèles sans tarif."""
    estimate = estimate_tokens(config, response_tokens)
    unpriced: list[str] = []
    total = 0.0

    # Le volume du modèle évalué se répartit également entre les modèles cochés.
    per_target_input = estimate.target_input / len(config.models.targets)
    per_target_output = estimate.target_output / len(config.models.targets)
    for target in config.models.targets:
        price = _price_of(target)
        if price is None:
            unpriced.append(target)
            continue
        total += per_target_input / 1e6 * price.input_per_mtok
        total += per_target_output / 1e6 * price.output_per_mtok

    if config.models.adversary and estimate.adversary_input:
        price = _price_of(config.models.adversary)
        if price is None:
            unpriced.append(config.models.adversary)
        else:
            total += estimate.adversary_input / 1e6 * price.input_per_mtok
            total += estimate.adversary_output / 1e6 * price.output_per_mtok

    price = _price_of(config.models.judge)
    if price is None:
        unpriced.append(config.models.judge)
    else:
        total += estimate.judge_input / 1e6 * price.input_per_mtok
        total += estimate.judge_output / 1e6 * price.output_per_mtok

    return total, unpriced


def estimate_cost(config: EvalRunConfig) -> CostEstimate:
    """Fourchette de coût d'un run, en dollars et en euros.

    La borne basse suppose des réponses courtes, la haute des réponses longues.
    Un modèle absent du tarif est signalé plutôt qu'ignoré : une estimation qui
    oublie silencieusement un modèle est pire que pas d'estimation du tout.
    """
    low, unpriced = _cost_for(config, SHORT_RESPONSE_TOKENS)
    high, _ = _cost_for(config, LONG_RESPONSE_TOKENS)
    volume = estimate_tokens(config)

    return CostEstimate(
        min_usd=round(low, 4),
        max_usd=round(high, 4),
        min_eur=round(low * USD_TO_EUR, 4),
        max_eur=round(high * USD_TO_EUR, 4),
        conversations=volume.conversations,
        model_calls=volume.model_calls,
        unpriced_models=sorted(set(unpriced)),
    )
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il passe**

Run: `.venv/bin/pytest tests/test_pricing.py -v`
Attendu : 10 passed.

- [ ] **Step 5: Ajouter la route d'estimation dans `backend/playground/eval_api.py`**

```python
@router.post("/api/eval-runs/estimate", response_model=CostEstimate)
def post_estimate(config: EvalRunConfig) -> CostEstimate:
    """Estime le coût d'un run sans rien lancer.

    Même schéma d'entrée que le lancement : l'interface peut donc estimer
    exactement ce qu'elle s'apprête à envoyer, sans transformation
    intermédiaire susceptible de diverger.
    """
    return estimate_cost(config)
```

Importer `CostEstimate` et `estimate_cost` depuis `playground.pricing`. `CostEstimate` étant une dataclass, FastAPI la sérialise ; si le typage pose problème, convertis-la en modèle pydantic dans `pricing.py` plutôt que d'ajouter une couche de conversion ici.

- [ ] **Step 6: Ajouter le test de la route**

Ajouter à `tests/test_eval_api.py` :

```python
def test_l_estimation_ne_lance_aucun_run(client: TestClient, tmp_path):
    response = client.post("/api/eval-runs/estimate", json=_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["min_usd"] < body["max_usd"]
    assert body["conversations"] == 3
    # Aucun run ne doit avoir été créé sur disque.
    assert client.get("/api/eval-runs").json() == []


def test_l_estimation_refuse_une_configuration_invalide(client: TestClient):
    payload = _payload()
    payload["scenarios"] = []
    assert client.post("/api/eval-runs/estimate", json=payload).status_code == 422
```

- [ ] **Step 7: Lancer toute la suite**

Run: `.venv/bin/pytest -v`
Attendu : tous les tests verts.

- [ ] **Step 8: Commit**

```bash
git add backend/playground/pricing.py tests/test_pricing.py backend/playground/eval_api.py tests/test_eval_api.py
git commit -m "feat: estimation du coût d'un run avant lancement"
```

---

### Task 5: Interface — scénarios multiples, import CSV et volume du run

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/app/page.tsx`

**Note :** invoque la skill `frontend-design` avant d'écrire. **Tous les textes affichés sont en anglais.** L'identité visuelle est posée — papier chaud et zinc, sarcelle pour l'action ordinaire, rouge **réservé exclusivement** à ce qui touche à l'adversaire. Prolonge-la.

- [ ] **Step 1: Adapter `web/lib/types.ts`**

Dans `EvalModels`, remplacer `target: string` par `targets: string[]`.
Dans `EvalRunConfig`, remplacer `scenario: EvalScenario` par `scenarios: EvalScenario[]`.
Dans `Conversation`, ajouter `scenario_index: number;` et `target: string;`.
Dans `EvalRunRecord`, remplacer `tally: Tally` par `tallies: Record<string, Tally>[];`.

- [ ] **Step 2: Le modèle évalué devient une sélection multiple**

Remplacer l'état `target` par `targets: string[]`. Le menu déroulant du modèle évalué devient une liste de cases à cocher, groupées par fournisseur. Un modèle dont la clé manque reste **affiché et désactivé** — l'utilisateur doit voir qu'il existe.

`readyToLaunch` exige `targets.length > 0`, et la charge utile envoie `targets`.

- [ ] **Step 3: Les scénarios deviennent une liste, saisie ou importée**

Deux modes, présentés côte à côte :

**Saisie manuelle** — les trois champs actuels, qui produisent une liste d'un seul scénario. C'est le mode par défaut : il sert le « j'ai une idée, tac, j'essaie » qui reste le chemin principal du produit.

**Import CSV** — un sélecteur de fichier. À la sélection, le fichier est lu **dans le navigateur**, sans être envoyé nulle part : on n'a besoin ni d'un point d'entrée d'envoi, ni de stockage, et les scénarios voyagent dans la charge utile du lancement comme s'ils avaient été saisis.

Après lecture, l'écran affiche les **noms de colonnes détectés** et trois listes déroulantes : quelle colonne porte le titre, laquelle le system prompt, laquelle le message d'ouverture. Rien n'est deviné — c'est l'utilisateur qui désigne, parce qu'un CSV venu d'ailleurs n'a aucune raison d'employer nos noms.

Une fois les trois colonnes désignées, affiche le nombre de scénarios chargés et un aperçu des trois premiers titres, pour que l'utilisateur constate qu'il a désigné les bonnes colonnes avant de lancer.

Écris le lecteur CSV à la main plutôt que d'ajouter une dépendance : gère le séparateur virgule, les champs entre guillemets contenant des virgules ou des retours à la ligne, et les guillemets échappés par doublement. Une ligne dont le nombre de champs ne correspond pas à l'en-tête est ignorée, et leur nombre est signalé à l'utilisateur — silencieusement écarter des lignes serait pire que de les refuser.

- [ ] **Step 4: Afficher le volume du run en permanence**

Sous la configuration, affiche ce qu'un lancement représente. C'est le garde-fou principal de cet écran : le volume est un produit de quatre facteurs et il explose sans qu'on s'en aperçoive.

```tsx
const conversationCount = scenarios.length * targets.length * repetitions;
const targetCalls = conversationCount * turns;
const adversaryCalls = conversationCount * Math.max(turns - 1, 0);
const judgeCalls = conversationCount;
const modelCalls = targetCalls + adversaryCalls + judgeCalls;
```

Formule-le en clair : « 20 scénarios × 3 modèles × 5 répétitions = 300 conversations, soit environ 2 700 appels de modèle. » Au-delà de quelques centaines de conversations, accompagne le chiffre d'un avertissement visible — sans jamais bloquer le lancement : c'est l'utilisateur qui décide.

- [ ] **Step 5: Vérifier à la main**

Lance l'API et le front. Vérifie : la saisie manuelle produit bien un scénario ; un CSV de trois lignes chargé et ses colonnes désignées affiche « 3 scénarios » ; cocher deux modèles fait passer le compteur de conversations à six ; un CSV mal formé signale ses lignes ignorées ; le bouton reste inactif tant qu'aucun scénario n'est disponible.

- [ ] **Step 6: Lint et commit**

```bash
npm --prefix web run lint
git add web/lib/types.ts web/app/page.tsx
git commit -m "feat: scénarios multiples, import CSV et volume du run"
```

---

### Task 6: Interface — la matrice et la fenêtre de détail

**Files:**
- Modify: `web/app/eval/[runId]/page.tsx`

**Note :** invoque la skill `frontend-design` avant d'écrire. **Tous les textes affichés sont en anglais.** La matrice a besoin d'une échelle de couleur pour l'échec : **elle ne doit pas réutiliser le rouge réservé à l'adversaire**, sous peine de brouiller un code déjà établi. Choisis une teinte distincte et documente ce choix.

- [ ] **Step 1: Afficher la matrice**

Quand le run est terminé, affiche une matrice : une ligne par scénario, une colonne par modèle évalué. Chaque case est colorée selon le taux d'échec du couple, d'autant plus intense que le modèle a cédé souvent.

```tsx
function failureRate(tally: Tally | undefined): number | null {
  if (!tally) return null;
  const judged = tally.met + tally.not_met + tally.borderline;
  return judged === 0 ? null : tally.met / judged;
}
```

Une case sans aucune conversation jugée doit être **visuellement distincte d'une case à zéro pour cent** : l'une veut dire « on ne sait pas », l'autre « le modèle a tenu à chaque fois ». Les confondre serait le pire contresens possible sur cet écran.

Avec un seul scénario, la matrice n'a qu'une ligne — c'est normal et ça doit rester lisible.

Sous la matrice, rappelle le nombre de répétitions par case et signale, le cas échéant, combien de conversations n'ont pas pu être jugées.

- [ ] **Step 2: La fenêtre de détail**

Cliquer sur une case ouvre une fenêtre superposée montrant **toutes les tentatives** de ce couple scénario × modèle, et pour chacune la conversation intégrale, exactement telle qu'elle a eu lieu. C'est une fenêtre de diagnostic : rien n'y est résumé ni tronqué.

En tête de la fenêtre :

- Le titre du scénario et le nom du modèle évalué.
- **Le system prompt reçu par le modèle évalué**, replié par défaut : il est identique pour toutes les tentatives, l'afficher déplié dix fois noierait le reste.
- **L'objectif de l'adversaire**, dans un bloc distinct portant la mention explicite qu'il n'a **jamais** été montré au modèle évalué. C'est l'utilisateur qui l'a écrit ; le lui cacher ne protège rien, et pouvoir confronter cet objectif à ce que l'adversaire a réellement produit est le seul moyen de diagnostiquer un adversaire qui sort de son rôle.

Puis, pour chaque tentative :

- Son numéro, son verdict et sa température.
- **La conversation tour par tour**, en distinguant nettement ce qui est **entré** dans le modèle évalué de ce qu'il a **produit**. Chaque message porte son numéro de tour — celui-là même que le juge cite dans sa justification, ce qui rend le verdict vérifiable.
- **Le verdict du juge et sa justification.**

**Ce qui reste interdit :** faire figurer l'objectif de l'adversaire parmi les messages de la conversation, ou annoter les messages entrants d'une mention révélant qu'ils viennent d'un adversaire. Ces messages s'affichent tels que le modèle évalué les a reçus — l'annoter biaiserait la lecture par une information qu'il n'avait pas.

La fenêtre se ferme par la touche d'échappement et par un clic hors de son cadre, et rend le focus clavier à la case dont elle est issue.

- [ ] **Step 3: Vérifier à la main**

Fabrique un run terminé en écrivant un fichier JSON dans `data/eval-runs/` — regarde le format dans `backend/playground/eval_schemas.py` — avec deux scénarios, deux modèles, et des verdicts variés dont une case entièrement non jugée. **Supprime ce fichier après coup.**

Attendu : la matrice affiche quatre cases correctement colorées ; la case non jugée se distingue d'une case à zéro pour cent ; cliquer sur une case ouvre la fenêtre avec les bonnes tentatives ; la touche d'échappement referme.

- [ ] **Step 4: Lint et commit**

```bash
npm --prefix web run lint
git add "web/app/eval/[runId]/page.tsx"
git commit -m "feat: matrice scénarios × modèles et fenêtre de détail"
```

---

### Task 7: Vérification réelle et README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Vérification réelle, avec de vraies clés**

Avec `./scripts/dev.sh`, lance depuis le navigateur une matrice délibérément petite : **deux scénarios saisis à la main, deux modèles parmi les moins chers du catalogue, une répétition, un tour**. Quatre conversations.

Attendu : le compteur de volume annonce 4 conversations et 8 appels ; le run se termine ; la matrice affiche 2 × 2 cases ; une case ouvre ses tentatives avec le transcript intégral et le verdict du juge.

Puis recommence en important un CSV de trois scénarios, pour vérifier la désignation des colonnes de bout en bout.

- [ ] **Step 2: Mettre le README à jour**

Décris le nouveau modèle : un run croise scénarios et modèles, les scénarios se saisissent ou s'importent depuis un CSV dont on désigne les colonnes, et le résultat est une matrice. Rappelle la formule du volume, et que le prix suit ce produit.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README à jour pour la matrice scénarios × modèles"
```

---

## Notes d'implémentation

**Ce que ce plan ne fait pas.** Aucun jugement par tour : la matrice dit *à quelle fréquence* un modèle cède, jamais *quand*. C'est un choix explicite.

**Le CSV n'est pas envoyé au serveur.** Il est lu dans le navigateur et ses scénarios voyagent dans la charge utile du lancement. Pas de point d'entrée d'envoi, pas de fichier stocké, pas de nettoyage à prévoir — et un scénario importé est indiscernable d'un scénario saisi, ce qui garde le moteur simple.

**Le garde-fou, c'est le compteur de volume.** Quatre facteurs se multiplient. Le run à 0,10 € de ce matin devient une facture à deux chiffres dès qu'on charge un CSV de vingt lignes sans regarder.
