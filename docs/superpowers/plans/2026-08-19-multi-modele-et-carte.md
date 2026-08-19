# Multi-modèle et carte de chaleur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Évaluer un scénario contre **plusieurs modèles à la fois** dans un même run, et lire d'un coup d'œil lequel tient et lequel cède, sur une carte de chaleur.

**Architecture:** Le modèle évalué devient une liste. Le dataset croise les modèles et les répétitions : un échantillon par couple. Chaque conversation retient quel modèle l'a produite, et le décompte devient un décompte par modèle. L'écran de résultat affiche une barre par modèle, colorée par la proportion d'échecs.

**Tech Stack:** inchangé — inspect-ai, pydantic, FastAPI, Next.js.

## Ce qui motive ce changement

Un run testait un seul modèle. Comparer deux modèles imposait deux runs, deux formulaires à remplir à l'identique, et une comparaison à faire de tête. La question qu'on pose vraiment est « lequel de ces modèles tient sur ce scénario » — elle mérite une seule action et une seule lecture.

## Global Constraints

- **Identifiants de code en anglais.** Le français est réservé aux docstrings, commentaires, textes de prompt, textes affichés et noms de fonctions de test.
- **Nos** messages d'erreur en français ; les messages natifs de pydantic restent en anglais.
- **Aucun test ne fait d'appel API réel** : le provider `mockllm/model` d'inspect, jamais un `get_model` remplacé.
- **Aucune donnée produite n'est jetée.**
- **Seul le modèle évalué est multiple.** L'adversaire et le juge restent uniques pour tout le run : si le juge changeait d'un modèle à l'autre, un écart de résultat ne serait plus attribuable au modèle évalué. C'est la même logique que pour la température, qui ne s'applique qu'au modèle évalué.
- **Le verdict reste binaire et global à la conversation** — a cédé ou non, sans tenir compte du tour. Aucun jugement par tour n'est introduit.
- **Rupture assumée :** les runs déjà enregistrés ne correspondent plus au schéma et disparaîtront de la liste, le stockage ignorant ce qu'il ne sait pas relire. Ce sont des runs de test, sans valeur.

---

### Task 1: Schémas — une liste de modèles évalués, un décompte par modèle

**Files:**
- Modify: `backend/playground/eval_schemas.py`
- Modify: `tests/test_eval_schemas.py`

**Interfaces:**
- Produces: `EvalModels.targets: list[str]` (au moins un, aucun vide) remplaçant `target: str` ; `Conversation.target: str` ; `EvalRunRecord.tallies: dict[str, Tally]` remplaçant `tally: Tally`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/test_eval_schemas.py` :

```python
def test_au_moins_un_modele_evalue_est_requis():
    with pytest.raises(ValidationError):
        EvalModels(targets=[], judge="m")


def test_un_modele_evalue_vide_est_refuse():
    with pytest.raises(ValidationError):
        EvalModels(targets=["m", ""], judge="m")


def test_plusieurs_modeles_evalues_sont_acceptes():
    models = EvalModels(targets=["a/1", "b/2", "c/3"], judge="m")
    assert models.targets == ["a/1", "b/2", "c/3"]


def test_un_modele_evalue_en_double_est_refuse():
    # Deux fois le même modèle produirait deux lignes identiques dans la carte
    # de chaleur, sans qu'on sache laquelle lire.
    with pytest.raises(ValidationError):
        EvalModels(targets=["a/1", "a/1"], judge="m")


def test_une_conversation_retient_le_modele_qui_l_a_produite():
    conversation = Conversation(
        conversation_id="c1", repetition=0, target="anthropic/claude-haiku-4-5"
    )
    assert conversation.target == "anthropic/claude-haiku-4-5"


def test_un_run_porte_un_decompte_par_modele():
    record = EvalRunRecord(
        run_id="r",
        created_at="2026-08-19T00:00:00",
        label=None,
        status="done",
        config=_config(),
    )
    assert record.tallies == {}
```

Adapter dans le même fichier toutes les constructions existantes de `EvalModels(target=...)` en `EvalModels(targets=[...])`.

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `.venv/bin/pytest tests/test_eval_schemas.py -v`
Attendu : échecs sur `targets` inconnu et sur `Conversation.target` inconnu.

- [ ] **Step 3: Modifier `backend/playground/eval_schemas.py`**

Remplacer `EvalModels` par :

```python
class EvalModels(BaseModel):
    """Les rôles de modèle d'un run d'évaluation.

    Seul le modèle évalué est multiple : c'est lui qu'on compare. L'adversaire
    et le juge restent uniques pour tout le run, sans quoi un écart de résultat
    entre deux modèles ne serait plus attribuable au modèle lui-même.
    """

    targets: list[str] = Field(min_length=1)
    adversary: str | None = None
    judge: str = Field(min_length=1)

    @model_validator(mode="after")
    def _modeles_evalues_valides(self) -> "EvalModels":
        if any(not target.strip() for target in self.targets):
            raise ValueError("Un identifiant de modèle évalué est vide.")
        if len(set(self.targets)) != len(self.targets):
            raise ValueError(
                "Le même modèle évalué est présent plusieurs fois."
            )
        return self

    @field_validator("adversary")
    @classmethod
    def _adversaire_non_vide(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("L'identifiant du modèle adversaire est vide.")
        return value
```

Ajouter `target` à `Conversation`, après `repetition` :

```python
    target: str = ""
    """Le modèle évalué qui a produit cette conversation."""
```

Remplacer dans `EvalRunRecord` le champ `tally` par :

```python
    tallies: dict[str, Tally] = Field(default_factory=dict)
    """Un décompte par modèle évalué, indexé par son identifiant."""
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `.venv/bin/pytest tests/test_eval_schemas.py -v`
Attendu : tous verts.

- [ ] **Step 5: Commit**

```bash
git add backend/playground/eval_schemas.py tests/test_eval_schemas.py
git commit -m "feat: le modèle évalué devient une liste, le décompte devient par modèle"
```

---

### Task 2: Moteur — croiser modèles et répétitions

**Files:**
- Modify: `backend/playground/eval_task.py`
- Modify: `backend/playground/eval_job.py`
- Modify: `tests/test_eval_task.py`
- Modify: `tests/test_eval_pipeline.py`

**Interfaces:**
- Consumes: les schémas de Task 1.
- Produces: `eval_dataset` produisant `len(targets) × repetitions` échantillons ; `tallies_of(conversations) -> dict[str, Tally]` remplaçant `tally_of`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `tests/test_eval_task.py` :

```python
def test_un_echantillon_par_couple_modele_repetition():
    config = _config(repetitions=4)
    config.models = EvalModels(targets=["a/1", "b/2", "c/3"], judge="m")
    assert len(eval_dataset(config)) == 12


def test_chaque_echantillon_porte_son_modele_evalue():
    config = _config(repetitions=2)
    config.models = EvalModels(targets=["a/1", "b/2"], judge="m")
    targets = [s.metadata["target"] for s in eval_dataset(config)]
    assert sorted(targets) == ["a/1", "a/1", "b/2", "b/2"]


def test_les_temperatures_recommencent_pour_chaque_modele():
    # Sinon le troisième modèle hériterait de températures décalées, et la
    # comparaison entre modèles porterait sur des réglages différents.
    config = _config(repetitions=3, temperature=TemperatureSpec(min=0.0, max=1.0))
    config.models = EvalModels(targets=["a/1", "b/2"], judge="m")
    samples = list(eval_dataset(config))
    par_modele: dict[str, list[float]] = {}
    for sample in samples:
        par_modele.setdefault(sample.metadata["target"], []).append(
            sample.metadata["temperature"]
        )
    assert par_modele["a/1"] == [0.0, 0.5, 1.0]
    assert par_modele["b/2"] == [0.0, 0.5, 1.0]
```

Ajouter à `tests/test_eval_pipeline.py` :

```python
def test_le_decompte_est_ventile_par_modele():
    conversations = [
        Conversation(conversation_id="a", repetition=0, target="m1", verdict="met"),
        Conversation(conversation_id="b", repetition=1, target="m1", verdict="not_met"),
        Conversation(conversation_id="c", repetition=0, target="m2", verdict="met"),
        Conversation(conversation_id="d", repetition=1, target="m2", verdict="met"),
        Conversation(conversation_id="e", repetition=2, target="m2", verdict=None),
    ]
    tallies = tallies_of(conversations)
    assert tallies["m1"].met == 1 and tallies["m1"].not_met == 1
    assert tallies["m2"].met == 2 and tallies["m2"].not_met == 0
    # La répétition non jugée n'entre dans aucune case, comme avant.
    assert tallies["m2"].borderline == 0


def test_un_modele_sans_aucune_conversation_n_apparait_pas():
    assert tallies_of([]) == {}
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `.venv/bin/pytest tests/test_eval_task.py tests/test_eval_pipeline.py -v`
Attendu : échecs sur le nombre d'échantillons et sur `tallies_of` inconnu.

- [ ] **Step 3: Modifier `eval_dataset` dans `backend/playground/eval_task.py`**

```python
def eval_dataset(config: EvalRunConfig) -> MemoryDataset:
    """Un échantillon par couple modèle évalué × répétition.

    Les températures sont recalculées à l'identique pour chaque modèle : c'est
    ce qui rend la comparaison honnête, chaque modèle recevant exactement les
    mêmes réglages que les autres.
    """
    temperatures = temperatures_for(config.temperature, config.repetitions)
    samples = []
    index = 0
    for target in config.models.targets:
        for repetition in range(config.repetitions):
            index += 1
            samples.append(
                Sample(
                    id=index,
                    input=config.scenario.opening_message,
                    metadata={
                        "target": target,
                        "repetition": repetition,
                        "temperature": temperatures[repetition],
                    },
                )
            )
    return MemoryDataset(samples, name="repetitions")
```

Et, dans `conversation_solver`, remplacer la construction du modèle évalué pour qu'elle lise l'échantillon plutôt que la configuration :

```python
        target_name = state.metadata.get("target") or config.models.targets[0]
        transcript = await run_conversation(
            system_prompt=config.scenario.system_prompt,
            opening_message=config.scenario.opening_message,
            turns=config.turns,
            target=get_model(target_name, **(model_args or {})),
            adversary=adversary,
            adversary_prompt=config.adversary_prompt,
            temperature=state.metadata.get("temperature"),
        )
```

- [ ] **Step 4: Modifier `backend/playground/eval_job.py`**

Remplacer `tally_of` par :

```python
def tallies_of(conversations: list[Conversation]) -> dict[str, Tally]:
    """Décompte des verdicts, ventilé par modèle évalué.

    Une répétition non jugée n'entre dans aucune case : l'écart entre la somme
    d'un décompte et le nombre de répétitions signale l'incident au lieu de le
    masquer.
    """
    tallies: dict[str, Tally] = {}
    for conversation in conversations:
        tally = tallies.setdefault(conversation.target, Tally())
        if conversation.verdict == "met":
            tally.met += 1
        elif conversation.verdict == "not_met":
            tally.not_met += 1
        elif conversation.verdict == "borderline":
            tally.borderline += 1
    return tallies
```

Dans `conversations_from_log`, reporter le modèle depuis les metadata de l'échantillon :

```python
                target=str(metadata.get("target") or ""),
```

Dans `run_eval_job`, remplacer l'affectation du décompte, et le modèle nominal passé à inspect :

```python
        record.tallies = tallies_of(record.conversations)
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

Le tri final des conversations doit rester stable et lisible : trier par modèle puis par répétition.

```python
    return sorted(
        conversations,
        key=lambda conversation: (conversation.target, conversation.repetition),
    )
```

- [ ] **Step 5: Adapter les tests existants**

Dans `tests/test_eval_task.py` et `tests/test_eval_pipeline.py`, remplacer chaque `EvalModels(target="mockllm/model", ...)` par `EvalModels(targets=["mockllm/model"], ...)`, et chaque lecture de `result.tally` par `result.tallies["mockllm/model"]`. Les assertions de fond ne changent pas.

- [ ] **Step 6: Lancer toute la suite**

Run: `.venv/bin/pytest -v`
Attendu : tous les tests verts.

- [ ] **Step 7: Commit**

```bash
git add backend/playground/eval_task.py backend/playground/eval_job.py tests/test_eval_task.py tests/test_eval_pipeline.py
git commit -m "feat: un run croise les modèles évalués et les répétitions"
```

---

### Task 3: API — lancement sous caffeinate et adaptation des tests

**Files:**
- Modify: `backend/playground/eval_api.py`
- Modify: `tests/test_eval_api.py`

**Interfaces:**
- Produces: le lancement de sous-process protégé contre la mise en veille.

**Pourquoi `caffeinate`.** Un run multi-modèle peut durer longtemps — trois modèles, dix répétitions, cinq tours font cent cinquante conversations. Sur macOS, la mise en veille de la machine interrompt le sous-process en cours de route, et le run reste bloqué en `running` pour toujours. `caffeinate -i` empêche la veille tant que le process qu'il enveloppe tourne.

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à `tests/test_eval_api.py` :

```python
def test_le_sous_process_est_protege_de_la_mise_en_veille(monkeypatch):
    """Un run long ne doit pas être interrompu par la veille de la machine."""
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
    # Sur macOS, la commande doit être enveloppée par caffeinate.
    if sys.platform == "darwin":
        assert argv[0].endswith("caffeinate")
        assert "-i" in argv
```

Ajouter `import sys` en tête du fichier de test s'il n'y est pas.

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `.venv/bin/pytest tests/test_eval_api.py -k veille -v`
Attendu : FAIL, la commande ne commence pas par `caffeinate`.

- [ ] **Step 3: Modifier `_launch_eval_subprocess` dans `backend/playground/eval_api.py`**

```python
def _launch_eval_subprocess(run_id: str) -> None:
    """Lance l'exécution d'un run d'évaluation dans un process séparé.

    Sur macOS, la commande est enveloppée dans `caffeinate -i` : un run
    multi-modèle peut durer longtemps, et la mise en veille de la machine
    interromprait le sous-process, laissant le run bloqué en cours pour
    toujours. `-i` empêche seulement la veille système, pas l'extinction de
    l'écran.

    Remplacé par un stub dans les tests : rien de ce module ne doit lancer un
    vrai run pendant la suite.
    """
    command = [sys.executable, "-m", "playground.eval_job", run_id]
    if sys.platform == "darwin":
        command = ["/usr/bin/caffeinate", "-i", *command]
    _EVAL_PROCESSES[run_id] = subprocess.Popen(command)
```

- [ ] **Step 4: Adapter les charges utiles des tests existants**

Dans `tests/test_eval_api.py`, remplacer dans `_payload` la clé `"target"` par `"targets"` avec une liste :

```python
        "models": {"targets": ["mockllm/model"], "judge": "mockllm/model"},
```

Et dans le test du multi-tours complet, remplacer de même.

- [ ] **Step 5: Lancer toute la suite**

Run: `.venv/bin/pytest -v`
Attendu : tous les tests verts.

- [ ] **Step 6: Commit**

```bash
git add backend/playground/eval_api.py tests/test_eval_api.py
git commit -m "feat: protège les runs longs de la mise en veille"
```

---

### Task 4: Interface — sélection multiple et carte de chaleur

**Files:**
- Modify: `web/lib/types.ts`
- Modify: `web/app/page.tsx`
- Modify: `web/app/eval/[runId]/page.tsx`

**Interfaces:**
- Consumes: l'API adaptée par les tâches précédentes.

**Note :** invoque la skill `frontend-design` avant d'écrire. L'identité visuelle est déjà posée — papier chaud et zinc, sarcelle pour l'action ordinaire, rouge **réservé exclusivement** à ce qui touche à l'adversaire. La carte de chaleur a besoin d'une échelle de couleur pour l'échec : **elle ne doit pas réutiliser ce rouge**, sous peine de brouiller le code déjà établi. Choisis une teinte distincte et documente ce choix.

- [ ] **Step 1: Adapter `web/lib/types.ts`**

Dans `EvalModels`, remplacer `target: string` par :

```typescript
  targets: string[];
```

Dans `Conversation`, ajouter après `repetition` :

```typescript
  target: string;
```

Dans `EvalRunRecord`, remplacer `tally: Tally` par :

```typescript
  tallies: Record<string, Tally>;
```

- [ ] **Step 2: Passer le modèle évalué en sélection multiple dans `web/app/page.tsx`**

Remplacer l'état `target` par une liste :

```tsx
  const [targets, setTargets] = useState<string[]>([]);
```

Le sélecteur unique du modèle évalué devient une liste de cases à cocher, une par modèle disponible, groupées par fournisseur. Un modèle dont la clé manque est affiché et désactivé, comme aujourd'hui pour les menus déroulants — l'utilisateur doit voir qu'il existe.

Sous la liste, affiche en permanence le volume que le run représente, parce que c'est là qu'il explose sans qu'on s'en aperçoive :

```tsx
  const conversationCount = targets.length * repetitions;
```

Affiche-le en clair, par exemple « 3 modèles × 10 répétitions × 5 tours = 30 conversations, 210 appels de modèle ». Le nombre d'appels vaut `conversationCount * (turns + Math.max(turns - 1, 0)) + conversationCount` — les tours du modèle évalué, ceux de l'adversaire, et un appel de juge par conversation.

`readyToLaunch` exige désormais `targets.length > 0`. La charge utile envoie `targets` au lieu de `target`.

- [ ] **Step 3: Ajouter la carte de chaleur dans `web/app/eval/[runId]/page.tsx`**

Au-dessus de la liste des conversations, quand le run est terminé, affiche une ligne par modèle évalué : le nom du modèle, une barre de dix segments dont la proportion colorée correspond au taux d'échec, et le pourcentage. Trie du plus résistant au plus fragile — c'est l'ordre dans lequel on lit une comparaison.

```tsx
function failureRate(tally: Tally): number {
  const judged = tally.met + tally.not_met + tally.borderline;
  return judged === 0 ? 0 : tally.met / judged;
}
```

Chaque ligne est cliquable et filtre la liste des conversations sur ce modèle. Les conversations affichent désormais le modèle qui les a produites.

**Le cas des répétitions non jugées doit rester visible** : si le nombre de conversations jugées d'un modèle est inférieur au nombre de répétitions, dis-le sur sa ligne. Un taux calculé sur sept conversations quand on en attendait dix ne doit pas se présenter comme un taux sur dix.

- [ ] **Step 3b: Le détail d'un modèle, en fenêtre superposée**

Cliquer sur la ligne d'un modèle ouvre une fenêtre superposée montrant **toutes ses
tentatives**, et pour chacune la conversation intégrale, exactement telle qu'elle a eu
lieu. Le but est le diagnostic : comprendre pourquoi un modèle a cédé, ou pourquoi un
run a produit un résultat surprenant. Rien ne doit être résumé ni reformulé.

Chaque tentative affiche, dans cet ordre :

1. **Son numéro, son verdict et sa température.**
2. **Le system prompt reçu par le modèle évalué**, replié par défaut — il est identique
   pour toutes les tentatives, l'afficher déplié dix fois noierait le reste.
3. **La conversation, tour par tour**, en distinguant nettement ce qui est **entré**
   dans le modèle évalué de ce qu'il a **produit**. Chaque message porte son numéro de
   tour, celui-là même que le juge cite dans sa justification — c'est ce qui rend le
   verdict vérifiable.
4. **Le verdict du juge et sa justification.**

Le contenu des messages s'affiche intégralement, sans troncature : c'est une fenêtre de
diagnostic, pas un aperçu.

**Sur l'objectif de l'adversaire.** Il est affiché en tête de la fenêtre, dans un bloc
distinct portant la mention explicite qu'il n'a **jamais** été montré au modèle évalué.
C'est l'utilisateur qui l'a écrit, donc le lui cacher ne protège rien ; et pouvoir
confronter cet objectif à ce que l'adversaire a réellement produit est le seul moyen de
diagnostiquer un adversaire qui sort de son rôle. L'invariant du produit porte sur ce que
reçoit le modèle évalué, pas sur ce que voit l'humain.

**Ce qui reste interdit :** faire figurer cet objectif parmi les messages de la
conversation, ou annoter les messages entrants d'une mention révélant qu'ils viennent
d'un adversaire. Ces messages s'affichent tels que le modèle évalué les a reçus.

La fenêtre se ferme par la touche d'échappement et par un clic hors de son cadre, et rend
le focus clavier à la ligne dont elle est issue.

- [ ] **Step 4: Vérifier à la main**

Lance l'API et le front, remplis le formulaire avec **deux modèles** cochés, une répétition, un tour, et lance.

Attendu : le compteur de volume s'actualise en cochant les modèles ; le run produit deux
conversations ; la carte affiche deux lignes ; cliquer sur une ligne ouvre la fenêtre de
détail avec les tentatives de ce modèle, leur conversation intégrale, le system prompt
repliable, le verdict du juge, et l'objectif de l'adversaire marqué comme non vu par le
modèle évalué ; la touche d'échappement referme la fenêtre.

- [ ] **Step 5: Lancer le lint**

Run: `npm --prefix web run lint`
Attendu : aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add web/lib/types.ts web/app/page.tsx "web/app/eval/[runId]/page.tsx"
git commit -m "feat: sélection multiple de modèles évalués et carte de chaleur"
```

---

## Notes d'implémentation

**Ce que ce plan ne fait pas.** Il n'introduit aucun jugement par tour : le verdict reste global à la conversation, et la carte ne dit pas *quand* un modèle a cédé, seulement *à quelle fréquence*. C'est un choix explicite de l'utilisateur du produit.

**Le point de vigilance.** Le prix d'un run est désormais multiplié par le nombre de modèles cochés. Le compteur de volume du formulaire n'est pas un ornement : c'est le seul garde-fou entre une comparaison à trois modèles et une facture inattendue.
