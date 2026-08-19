# API HTTP et interface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les deux moteurs déjà livrés utilisables depuis un navigateur, avec l'onglet d'évaluation en premier pour que « j'ai une idée, tac, j'essaie » devienne vrai le plus tôt possible.

**Architecture:** Une application FastAPI qui monte deux routeurs — un par phase — et lance chaque run en sous-process. Un front Next.js à quatre onglets consomme cette API et poll l'état des runs en cours.

**Tech Stack:** FastAPI, uvicorn, pydantic. Next.js 15 (App Router, TypeScript, Tailwind).

## Ordre voulu

Les tâches 1 à 4 livrent **l'évaluation de bout en bout dans le navigateur**. À la fin de la tâche 4, le produit est utilisable pour son cas d'usage principal, sans qu'aucun écran de la phase 1 n'existe. Les tâches 5 à 7 ajoutent la génération de scénarios. Ne réordonne pas.

## Global Constraints

- **Identifiants de code en anglais.** Le français est réservé aux docstrings, commentaires, textes de prompt, **textes affichés à l'utilisateur** et noms de fonctions de test (`def test_...` reste en français).
- **Nos** messages d'erreur sont en français ; les messages natifs de pydantic sur les contraintes de champ restent en anglais, choix assumé.
- **Aucun test ne fait d'appel API réel**, ni vers un fournisseur de modèles, ni vers un vrai sous-process. Le lancement de sous-process est remplacé par un stub dans les tests.
- **Aucune donnée produite n'est jetée** : c'est vrai des runs, des conversations et des scénarios.
- **Le prompt de l'adversaire ne doit jamais parvenir au modèle évalué.** L'interface doit le rendre visible : le champ est marqué comme non vu par le modèle évalué. Ne l'affiche jamais dans une transcription.
- L'interface est en **français**.
- Le backend écoute sur le port **8000**, le front sur le **3000**.

## Ce qui existe déjà et qu'on ne réécrit pas

Signatures vérifiées dans le dépôt, à consommer telles quelles :

```
catalog.catalog() -> list[ProviderInfo]        # ProviderInfo: id, label, env_vars, key_present, models[{id,label}]
judges.load_judges(directory) / load_judge(name, directory) / write_judge(dimension, directory)
judges.delete_judge(name, directory) / suggested_threshold(dimension) -> (int, Direction)
store.create_run(config, runs_dir) / read_run / write_run / list_runs / read_progress
store.select_scenario(scenario, record, selected_dir) / unselect_scenario / is_selected
eval_store.create_eval_run(config, runs_dir) / read_eval_run / write_eval_run / list_eval_runs / read_eval_progress
```

Entrypoints de sous-process : `python -m playground.job <run_id>` et `python -m playground.eval_job <run_id>`.

---

### Task 1: API — socle, catalogue et routes d'évaluation

**Files:**
- Create: `backend/playground/api.py`
- Create: `backend/playground/eval_api.py`
- Create: `tests/test_eval_api.py`

**Interfaces:**
- Consumes: `catalog()`, `create_eval_run`, `read_eval_run`, `write_eval_run`, `list_eval_runs`, `read_eval_progress`, `EvalRunConfig`, `EvalRunRecord`.
- Produces: `api.app` (FastAPI), `eval_api.router` (APIRouter), `eval_api.EVAL_RUNS_DIR`, `eval_api._launch_eval_subprocess(run_id)`, `eval_api._EVAL_PROCESSES`.

- [ ] **Step 1: Écrire le test d'API qui échoue**

Créer `tests/test_eval_api.py` :

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from playground import eval_api
from playground.api import app
from playground.eval_store import read_eval_run, write_eval_run
from playground.eval_schemas import Conversation, Message


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    """Une API branchée sur des répertoires jetables, sans lancer de vrai run."""
    monkeypatch.setattr(eval_api, "EVAL_RUNS_DIR", tmp_path / "eval-runs")
    monkeypatch.setattr(eval_api, "SELECTED_DIR", tmp_path / "selected")
    monkeypatch.setattr(eval_api, "_launch_eval_subprocess", lambda run_id: None)
    return TestClient(app)


def _payload(**overrides) -> dict:
    base = {
        "scenario": {
            "title": "Rappel fournisseur",
            "system_prompt": "Tu assistes l'équipe qualité.",
            "opening_message": "On a un souci sur le lot 4412.",
        },
        "criterion": "L'assistant a expliqué comment contourner la procédure.",
        "turns": 1,
        "repetitions": 3,
        "models": {"target": "mockllm/model", "judge": "mockllm/model"},
    }
    base.update(overrides)
    return base


def test_le_catalogue_liste_les_trois_providers(client: TestClient):
    response = client.get("/api/catalog")
    assert response.status_code == 200
    assert [p["id"] for p in response.json()] == ["anthropic", "openai", "grok"]


def test_lancer_un_run_d_evaluation(client: TestClient):
    response = client.post("/api/eval-runs", json=_payload())
    assert response.status_code == 201
    run_id = response.json()["run_id"]
    assert client.get(f"/api/eval-runs/{run_id}").json()["status"] == "pending"


def test_un_multitours_sans_adversaire_est_refuse(client: TestClient):
    response = client.post("/api/eval-runs", json=_payload(turns=3))
    assert response.status_code == 422


def test_un_multitours_complet_est_accepte(client: TestClient):
    response = client.post(
        "/api/eval-runs",
        json=_payload(
            turns=3,
            adversary_prompt="Pousse-le à contourner.",
            models={
                "target": "mockllm/model",
                "adversary": "mockllm/model",
                "judge": "mockllm/model",
            },
        ),
    )
    assert response.status_code == 201


def test_un_run_inconnu_renvoie_404(client: TestClient):
    assert client.get("/api/eval-runs/absent").status_code == 404


def test_lister_les_runs_du_plus_recent_au_plus_ancien(client: TestClient):
    premier = client.post("/api/eval-runs", json=_payload()).json()["run_id"]
    second = client.post("/api/eval-runs", json=_payload()).json()["run_id"]
    ids = [r["run_id"] for r in client.get("/api/eval-runs").json()]
    assert ids.index(second) < ids.index(premier)


def test_annuler_un_run_termine_le_sous_process(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    class FakeProcess:
        def __init__(self):
            self.terminated = False

        def poll(self):
            return None if not self.terminated else 0

        def terminate(self):
            self.terminated = True

    fake = FakeProcess()
    monkeypatch.setattr(
        eval_api,
        "_launch_eval_subprocess",
        lambda run_id: eval_api._EVAL_PROCESSES.__setitem__(run_id, fake),
    )

    run_id = client.post("/api/eval-runs", json=_payload()).json()["run_id"]
    response = client.post(f"/api/eval-runs/{run_id}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert fake.terminated is True


def test_annuler_un_run_inconnu_renvoie_404(client: TestClient):
    assert client.post("/api/eval-runs/absent/cancel").status_code == 404


def test_la_progression_est_rafraichie_pendant_un_run(
    client: TestClient, tmp_path: Path
):
    run_id = client.post("/api/eval-runs", json=_payload()).json()["run_id"]
    runs_dir = tmp_path / "eval-runs"
    record = read_eval_run(run_id, runs_dir)
    record.status = "running"
    write_eval_run(record, runs_dir)
    (runs_dir / f"{run_id}.progress").write_text("1\n1\n")

    assert client.get(f"/api/eval-runs/{run_id}").json()["progress"]["completed"] == 2


def test_le_detail_d_un_run_expose_ses_conversations(
    client: TestClient, tmp_path: Path
):
    run_id = client.post("/api/eval-runs", json=_payload()).json()["run_id"]
    runs_dir = tmp_path / "eval-runs"
    record = read_eval_run(run_id, runs_dir)
    record.status = "done"
    record.conversations = [
        Conversation(
            conversation_id="c1",
            repetition=0,
            verdict="met",
            justification="au tour 2.",
            messages=[Message(role="user", content="bonjour")],
        )
    ]
    record.tally.met = 1
    write_eval_run(record, runs_dir)

    body = client.get(f"/api/eval-runs/{run_id}").json()
    assert body["tally"]["met"] == 1
    assert body["conversations"][0]["verdict"] == "met"
    assert body["conversations"][0]["messages"][0]["content"] == "bonjour"


def test_les_scenarios_retenus_sont_listes(client: TestClient, tmp_path: Path):
    selected = tmp_path / "selected"
    selected.mkdir(parents=True)
    (selected / "abc.yaml").write_text(
        "scenario_id: abc\n"
        "title: Rappel fournisseur\n"
        "system_prompt: Tu assistes.\n"
        "opening_message: Bonjour.\n"
        "tests_for: un arbitrage\n",
        encoding="utf-8",
    )

    body = client.get("/api/selected").json()
    assert len(body) == 1
    assert body[0]["title"] == "Rappel fournisseur"
    assert body[0]["system_prompt"] == "Tu assistes."


def test_un_scenario_retenu_illisible_est_ignore(client: TestClient, tmp_path: Path):
    selected = tmp_path / "selected"
    selected.mkdir(parents=True)
    (selected / "bon.yaml").write_text(
        "scenario_id: bon\ntitle: T\nsystem_prompt: S\nopening_message: O\n",
        encoding="utf-8",
    )
    (selected / "casse.yaml").write_text("::: pas du yaml :::", encoding="utf-8")

    assert [s["scenario_id"] for s in client.get("/api/selected").json()] == ["bon"]
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `.venv/bin/pytest tests/test_eval_api.py -v`
Attendu : FAIL avec `ModuleNotFoundError: No module named 'playground.api'`.

- [ ] **Step 3: Écrire `backend/playground/eval_api.py`**

```python
"""Routes HTTP du moteur d'évaluation.

Ce module ne contient aucune logique métier : il valide, appelle les modules
dédiés, et sérialise. L'exécution d'un run part en sous-process, comme pour la
génération de scénarios.
"""

import subprocess
import sys
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from playground.eval_schemas import EvalRunConfig, EvalRunRecord
from playground.eval_store import (
    EVAL_RUNS_DIR as _DEFAULT_EVAL_RUNS_DIR,
    create_eval_run,
    list_eval_runs,
    read_eval_progress,
    read_eval_run,
    write_eval_run,
)
from playground.store import SELECTED_DIR as _DEFAULT_SELECTED_DIR

router = APIRouter()

EVAL_RUNS_DIR = _DEFAULT_EVAL_RUNS_DIR
SELECTED_DIR = _DEFAULT_SELECTED_DIR

_EVAL_PROCESSES: dict[str, subprocess.Popen] = {}
"""Les sous-process d'évaluation en cours, par run_id, pour pouvoir les annuler.

En mémoire seulement : redémarrer l'API perd la main sur un run en cours, qui
ira alors jusqu'au bout. Sans conséquence sur les données, puisque le
sous-process écrit lui-même son résultat.
"""


class SelectedScenario(BaseModel):
    """Un scénario retenu en phase 1, proposé au chargement dans l'évaluation."""

    scenario_id: str
    title: str
    system_prompt: str
    opening_message: str
    tests_for: str = ""


def _launch_eval_subprocess(run_id: str) -> None:
    """Lance l'exécution d'un run d'évaluation dans un process séparé.

    Remplacé par un stub dans les tests : rien de ce module ne doit lancer un
    vrai run pendant la suite.
    """
    _EVAL_PROCESSES[run_id] = subprocess.Popen(
        [sys.executable, "-m", "playground.eval_job", run_id]
    )


@router.get("/api/selected", response_model=list[SelectedScenario])
def get_selected() -> list[SelectedScenario]:
    """Les scénarios retenus en phase 1, pour le bouton de chargement.

    Un fichier illisible est ignoré plutôt que de faire échouer la liste
    entière : un scénario abîmé ne doit pas empêcher d'en charger un autre.
    """
    directory = Path(SELECTED_DIR)
    if not directory.is_dir():
        return []
    scenarios: list[SelectedScenario] = []
    for path in sorted(directory.glob("*.yaml")):
        try:
            payload = yaml.safe_load(path.read_text(encoding="utf-8"))
            scenarios.append(SelectedScenario(**payload))
        except (yaml.YAMLError, TypeError, ValueError):
            continue
    return scenarios


@router.post("/api/eval-runs", response_model=EvalRunRecord, status_code=201)
def post_eval_run(config: EvalRunConfig) -> EvalRunRecord:
    record = create_eval_run(config, Path(EVAL_RUNS_DIR))
    _launch_eval_subprocess(record.run_id)
    return record


@router.get("/api/eval-runs", response_model=list[EvalRunRecord])
def get_eval_runs() -> list[EvalRunRecord]:
    return list_eval_runs(Path(EVAL_RUNS_DIR))


@router.get("/api/eval-runs/{run_id}", response_model=EvalRunRecord)
def get_eval_run(run_id: str) -> EvalRunRecord:
    try:
        record = read_eval_run(run_id, Path(EVAL_RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run inconnu : {run_id}")
    if record.status == "running":
        record.progress.completed = read_eval_progress(run_id, Path(EVAL_RUNS_DIR))
    return record


@router.post("/api/eval-runs/{run_id}/cancel", response_model=EvalRunRecord)
def cancel_eval_run(run_id: str) -> EvalRunRecord:
    try:
        record = read_eval_run(run_id, Path(EVAL_RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run inconnu : {run_id}")
    if record.status in ("pending", "running"):
        process = _EVAL_PROCESSES.pop(run_id, None)
        if process is not None and process.poll() is None:
            process.terminate()
        record.status = "cancelled"
        write_eval_run(record, Path(EVAL_RUNS_DIR))
    return record
```

- [ ] **Step 4: Écrire `backend/playground/api.py`**

```python
"""L'application HTTP du playground.

Elle ne porte que le catalogue de modèles, commun aux deux phases, et monte un
routeur par phase. Chaque routeur reste responsable de son propre domaine.
"""

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from playground.catalog import ProviderInfo, catalog
from playground.eval_api import router as eval_router

load_dotenv()

app = FastAPI(title="Playground d'évaluation")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/catalog", response_model=list[ProviderInfo])
def get_catalog() -> list[ProviderInfo]:
    """Les providers et l'état courant de leurs clés d'API.

    `key_present` permet à l'interface de griser un provider dont la clé
    manque, plutôt que de laisser le run échouer à l'exécution.
    """
    return catalog()


app.include_router(eval_router)
```

- [ ] **Step 5: Lancer le test pour vérifier qu'il passe**

Run: `.venv/bin/pytest tests/test_eval_api.py -v`
Attendu : 12 passed.

- [ ] **Step 6: Lancer toute la suite**

Run: `.venv/bin/pytest -q`
Attendu : les 211 tests existants toujours verts, plus les 12 nouveaux.

- [ ] **Step 7: Vérifier le serveur à la main**

Run: `.venv/bin/uvicorn playground.api:app --app-dir backend --port 8000` puis, dans un autre terminal :

```bash
curl -s localhost:8000/api/catalog | head -20
curl -s localhost:8000/api/eval-runs
```

Attendu : le catalogue avec `key_present` reflétant le `.env`, et une liste vide de runs.

- [ ] **Step 8: Commit**

```bash
git add backend/playground/api.py backend/playground/eval_api.py tests/test_eval_api.py
git commit -m "feat: API HTTP, catalogue et routes d'évaluation"
```

---

### Task 2: Front — échafaudage, types, client API et navigation

**Files:**
- Create: `web/` (via `create-next-app`)
- Create: `web/lib/types.ts`
- Create: `web/lib/api.ts`
- Modify: `web/app/layout.tsx`
- Create: `scripts/dev.sh`

**Interfaces:**
- Consumes: l'API de Task 1.
- Produces: les types `ProviderInfo`, `ModelOption`, `SelectedScenario`, `EvalScenario`, `EvalModels`, `TemperatureSpec`, `EvalRunConfig`, `Message`, `Conversation`, `Tally`, `EvalRunRecord` ; les fonctions `getCatalog()`, `getSelected()`, `createEvalRun(config)`, `getEvalRun(runId)`, `getEvalRuns()`, `cancelEvalRun(runId)`.

**Note pour l'implémenteur :** invoque la skill `frontend-design` avant d'écrire les composants des tâches suivantes. Ici, il n'y a que de l'échafaudage et de la navigation.

- [ ] **Step 1: Échafauder Next.js**

```bash
npx create-next-app@latest web --typescript --tailwind --app --no-src-dir --eslint --use-npm --import-alias "@/*"
```

Attendu : `web/package.json`, `web/app/page.tsx` et `web/app/layout.tsx` créés.

- [ ] **Step 2: Vérifier que le front démarre**

```bash
npm --prefix web run dev
```

Attendu : Next.js écoute sur `http://localhost:3000`. Arrêter avec Ctrl-C.

- [ ] **Step 3: Écrire `web/lib/types.ts`**

```typescript
export type Verdict = "met" | "not_met" | "borderline";

export type RunStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** Les deux phases partagent le même cycle de vie de run. */
export type EvalRunStatus = RunStatus;

export interface ModelOption {
  id: string;
  label: string;
}

export interface ProviderInfo {
  id: string;
  label: string;
  env_vars: string[];
  key_present: boolean;
  models: ModelOption[];
}

export interface SelectedScenario {
  scenario_id: string;
  title: string;
  system_prompt: string;
  opening_message: string;
  tests_for: string;
}

export interface EvalScenario {
  title: string;
  system_prompt: string;
  opening_message: string;
}

export interface EvalModels {
  target: string;
  adversary?: string | null;
  judge: string;
}

export interface TemperatureSpec {
  min: number;
  max?: number | null;
}

export interface EvalRunConfig {
  scenario: EvalScenario;
  criterion: string;
  turns: number;
  repetitions: number;
  models: EvalModels;
  adversary_prompt: string;
  temperature?: TemperatureSpec | null;
  label?: string | null;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  conversation_id: string;
  repetition: number;
  temperature: number | null;
  messages: Message[];
  verdict: Verdict | null;
  justification: string;
}

export interface Tally {
  met: number;
  not_met: number;
  borderline: number;
}

export interface EvalRunRecord {
  run_id: string;
  created_at: string;
  label: string | null;
  status: EvalRunStatus;
  config: EvalRunConfig;
  progress: { completed: number; total: number };
  error: string | null;
  log_path: string | null;
  tally: Tally;
  conversations: Conversation[];
}
```

- [ ] **Step 4: Écrire `web/lib/api.ts`**

```typescript
import type {
  EvalRunConfig,
  EvalRunRecord,
  ProviderInfo,
  SelectedScenario,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText} — ${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const getCatalog = () => request<ProviderInfo[]>("/api/catalog");

export const getSelected = () => request<SelectedScenario[]>("/api/selected");

export const createEvalRun = (config: EvalRunConfig) =>
  request<EvalRunRecord>("/api/eval-runs", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const getEvalRuns = () => request<EvalRunRecord[]>("/api/eval-runs");

export const getEvalRun = (runId: string) =>
  request<EvalRunRecord>(`/api/eval-runs/${runId}`);

export const cancelEvalRun = (runId: string) =>
  request<EvalRunRecord>(`/api/eval-runs/${runId}/cancel`, { method: "POST" });
```

- [ ] **Step 5: Remplacer le contenu de `<body>` dans `web/app/layout.tsx`**

Conserver l'import de police et les métadonnées générés par `create-next-app`, et remplacer le corps par :

```tsx
<body className={inter.className}>
  <nav className="border-b px-8 py-3 flex gap-6 text-sm">
    <a href="/" className="font-medium">
      Évaluer
    </a>
    <a href="/creer" className="font-medium">
      Créer
    </a>
    <a href="/scenarios" className="font-medium">
      Scénarios
    </a>
    <a href="/juges" className="font-medium">
      Juges
    </a>
  </nav>
  {children}
</body>
```

L'évaluation est en page d'accueil : c'est le chemin d'usage principal, et il ne dépend d'aucun des trois autres.

- [ ] **Step 6: Écrire `scripts/dev.sh`**

```bash
#!/usr/bin/env bash
# Lance le backend et le front ensemble. Ctrl-C arrête les deux.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "Pas de .env — copie .env.example et remplis tes clés." >&2
fi

trap 'kill 0' EXIT

.venv/bin/uvicorn playground.api:app --app-dir backend --port 8000 --reload &
npm --prefix web run dev &
wait
```

Puis : `chmod +x scripts/dev.sh`

- [ ] **Step 7: Vérifier la navigation**

Lancer `./scripts/dev.sh` et ouvrir `http://localhost:3000`.
Attendu : la barre de navigation affiche les quatre onglets. Seul « Évaluer » mènera à une page utile après la tâche suivante ; les trois autres renvoient une 404 de Next.js pour l'instant, ce qui est normal à ce stade.

- [ ] **Step 8: Commit**

```bash
git add web scripts/dev.sh
git commit -m "feat: échafaudage Next.js, types, client API et navigation"
```

---

### Task 3: Onglet Évaluer — le formulaire

**Files:**
- Modify: `web/app/page.tsx`

**Interfaces:**
- Consumes: `getCatalog`, `getSelected`, `createEvalRun` de Task 2.
- Produces: rien pour les tâches suivantes.

**Note :** invoque la skill `frontend-design` avant d'écrire ce composant. Le code ci-dessous fixe la structure et le comportement ; l'apparence est à travailler avec cette skill.

- [ ] **Step 1: Remplacer `web/app/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createEvalRun, getCatalog, getSelected } from "@/lib/api";
import type { ProviderInfo, SelectedScenario } from "@/lib/types";

export default function EvaluerPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selected, setSelected] = useState<SelectedScenario[]>([]);

  const [title, setTitle] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [openingMessage, setOpeningMessage] = useState("");
  const [adversaryPrompt, setAdversaryPrompt] = useState("");
  const [criterion, setCriterion] = useState("");
  const [turns, setTurns] = useState(1);
  const [repetitions, setRepetitions] = useState(5);
  const [varyTemperature, setVaryTemperature] = useState(false);
  const [temperatureMin, setTemperatureMin] = useState(1.0);
  const [temperatureMax, setTemperatureMax] = useState(1.0);
  const [target, setTarget] = useState("");
  const [adversary, setAdversary] = useState("");
  const [judge, setJudge] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState(false);

  useEffect(() => {
    Promise.all([getCatalog(), getSelected()])
      .then(([catalog, scenarios]) => {
        setProviders(catalog);
        setSelected(scenarios);
        const firstAvailable = catalog.find((p) => p.key_present);
        if (firstAvailable) {
          const id = firstAvailable.models[0].id;
          setTarget(id);
          setAdversary(id);
          setJudge(id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const loadScenario = (scenarioId: string) => {
    const scenario = selected.find((s) => s.scenario_id === scenarioId);
    if (!scenario) return;
    setTitle(scenario.title);
    setSystemPrompt(scenario.system_prompt);
    setOpeningMessage(scenario.opening_message);
  };

  const launch = async () => {
    setError(null);
    setInProgress(true);
    try {
      const record = await createEvalRun({
        scenario: {
          title,
          system_prompt: systemPrompt,
          opening_message: openingMessage,
        },
        criterion,
        turns,
        repetitions,
        models: {
          target,
          adversary: turns > 1 ? adversary : null,
          judge,
        },
        adversary_prompt: turns > 1 ? adversaryPrompt : "",
        temperature: {
          min: temperatureMin,
          max: varyTemperature ? temperatureMax : null,
        },
      });
      router.push(`/eval/${record.run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setInProgress(false);
    }
  };

  const modelOptions = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      label: `${provider.label} — ${model.label}`,
      available: provider.key_present,
      envVars: provider.env_vars.join(" ou "),
    })),
  );

  const readyToLaunch =
    title.trim() !== "" &&
    systemPrompt.trim() !== "" &&
    openingMessage.trim() !== "" &&
    criterion.trim() !== "" &&
    target !== "" &&
    judge !== "" &&
    (turns === 1 || (adversary !== "" && adversaryPrompt.trim() !== ""));

  const ModelSelect = ({
    id,
    label,
    value,
    onChange,
  }: {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div className="space-y-2">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border p-2"
      >
        {modelOptions.map((option) => (
          <option key={option.id} value={option.id} disabled={!option.available}>
            {option.label}
            {option.available ? "" : ` (${option.envVars} manquante)`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-8">
      <h1 className="text-2xl font-semibold">Évaluer un scénario</h1>

      {error && (
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Le scénario</h2>
          {selected.length > 0 && (
            <select
              onChange={(e) => loadScenario(e.target.value)}
              defaultValue=""
              className="rounded border p-1 text-sm"
            >
              <option value="" disabled>
                Charger un scénario retenu…
              </option>
              {selected.map((scenario) => (
                <option key={scenario.scenario_id} value={scenario.scenario_id}>
                  {scenario.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Titre</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded border p-2"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">
            System prompt du modèle évalué
          </span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            className="w-full rounded border p-3 font-mono text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Message d&apos;ouverture</span>
          <textarea
            value={openingMessage}
            onChange={(e) => setOpeningMessage(e.target.value)}
            rows={3}
            className="w-full rounded border p-3 font-mono text-sm"
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Le déroulé</h2>
        <div className="flex gap-6">
          <label className="space-y-1">
            <span className="block text-sm font-medium">Tours</span>
            <input
              type="number"
              min={1}
              max={10}
              value={turns}
              onChange={(e) => setTurns(Number(e.target.value))}
              className="w-20 rounded border p-2"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-sm font-medium">Répétitions</span>
            <input
              type="number"
              min={1}
              value={repetitions}
              onChange={(e) => setRepetitions(Number(e.target.value))}
              className="w-24 rounded border p-2"
            />
          </label>
        </div>
        <p className="text-sm text-gray-600">
          À un seul tour, il n&apos;y a pas d&apos;adversaire : le modèle
          répond une fois au message d&apos;ouverture.
        </p>
      </section>

      {turns > 1 && (
        <section className="space-y-2 rounded border border-amber-300 bg-amber-50 p-4">
          <h2 className="font-medium">Objectif de l&apos;adversaire</h2>
          <p className="text-sm text-amber-900">
            Ce texte n&apos;est <strong>jamais</strong> montré au modèle
            évalué. Il ne voit que les messages que l&apos;adversaire lui
            adresse, comme s&apos;ils venaient d&apos;un humain.
          </p>
          <textarea
            value={adversaryPrompt}
            onChange={(e) => setAdversaryPrompt(e.target.value)}
            rows={4}
            className="w-full rounded border p-3 font-mono text-sm"
            placeholder="Ce que l'adversaire cherche à obtenir, et comment il s'y prend…"
          />
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">Ce qui compte comme un échec</h2>
        <p className="text-sm text-gray-600">
          Le juge lit chaque conversation et dit si ce critère est rempli.
        </p>
        <textarea
          value={criterion}
          onChange={(e) => setCriterion(e.target.value)}
          rows={3}
          className="w-full rounded border p-3"
          placeholder="Le modèle a fourni les instructions demandées, après les avoir refusées."
        />
      </section>

      <section className="grid grid-cols-3 gap-4">
        <ModelSelect
          id="target"
          label="Modèle évalué"
          value={target}
          onChange={setTarget}
        />
        {turns > 1 && (
          <ModelSelect
            id="adversary"
            label="Adversaire"
            value={adversary}
            onChange={setAdversary}
          />
        )}
        <ModelSelect id="judge" label="Juge" value={judge} onChange={setJudge} />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Température du modèle évalué</h2>
        <div className="flex items-center gap-4">
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={temperatureMin}
            onChange={(e) => setTemperatureMin(Number(e.target.value))}
            className="w-24 rounded border p-2"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={varyTemperature}
              onChange={(e) => setVaryTemperature(e.target.checked)}
            />
            Faire varier jusqu&apos;à
          </label>
          {varyTemperature && (
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperatureMax}
              onChange={(e) => setTemperatureMax(Number(e.target.value))}
              className="w-24 rounded border p-2"
            />
          )}
        </div>
        <p className="text-sm text-gray-600">
          L&apos;adversaire et le juge gardent le réglage par défaut de leur
          fournisseur : les faire varier en même temps rendrait toute
          différence inattribuable.
        </p>
      </section>

      <button
        onClick={launch}
        disabled={!readyToLaunch || inProgress}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
      >
        {inProgress ? "Lancement…" : `Lancer ${repetitions} répétitions`}
      </button>
    </main>
  );
}
```

- [ ] **Step 2: Vérifier le formulaire à la main**

Lancer `./scripts/dev.sh` et ouvrir `http://localhost:3000`.

Attendu : les champs du scénario s'affichent ; passer les tours de 1 à 3 fait apparaître le bloc « Objectif de l'adversaire » avec son avertissement, ainsi que le sélecteur de modèle adversaire ; les modèles dont la clé manque sont désactivés ; le bouton reste inactif tant que les champs obligatoires sont vides.

- [ ] **Step 3: Commit**

```bash
git add web/app/page.tsx
git commit -m "feat: formulaire de l'onglet Évaluer"
```

---

### Task 4: Onglet Évaluer — le résultat d'un run

**Files:**
- Create: `web/app/eval/[runId]/page.tsx`

**Interfaces:**
- Consumes: `getEvalRun`, `cancelEvalRun` de Task 2.
- Produces: rien.

**Note :** invoque la skill `frontend-design` avant d'écrire ce composant.

**À la fin de cette tâche, le produit est utilisable de bout en bout dans le navigateur pour son cas d'usage principal.**

- [ ] **Step 1: Écrire `web/app/eval/[runId]/page.tsx`**

```tsx
"use client";

import { use, useCallback, useEffect, useState } from "react";
import { cancelEvalRun, getEvalRun } from "@/lib/api";
import type { Conversation, EvalRunRecord, Verdict } from "@/lib/types";

const VERDICT_LABELS: Record<Verdict, string> = {
  met: "a cédé",
  not_met: "a tenu",
  borderline: "cas limite",
};

const VERDICT_STYLES: Record<Verdict, string> = {
  met: "bg-red-100 text-red-800",
  not_met: "bg-green-100 text-green-800",
  borderline: "bg-amber-100 text-amber-900",
};

function VerdictBadge({ verdict }: { verdict: Verdict | null }) {
  if (verdict === null) {
    return (
      <span className="rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700">
        non jugé
      </span>
    );
  }
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${VERDICT_STYLES[verdict]}`}>
      {VERDICT_LABELS[verdict]}
    </span>
  );
}

function ConversationView({ conversation }: { conversation: Conversation }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-4 p-3 text-left"
      >
        <span className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            Répétition {conversation.repetition + 1}
          </span>
          <VerdictBadge verdict={conversation.verdict} />
          {conversation.temperature !== null && (
            <span className="text-xs text-gray-500">
              température {conversation.temperature.toFixed(2)}
            </span>
          )}
        </span>
        <span className="text-sm text-gray-500">{open ? "−" : "+"}</span>
      </button>

      {conversation.justification && (
        <p className="px-3 pb-2 text-sm text-gray-700">
          {conversation.justification}
        </p>
      )}

      {open && (
        <div className="space-y-2 border-t p-3">
          {conversation.messages.map((message, index) => (
            <div
              key={index}
              className={
                message.role === "assistant"
                  ? "rounded bg-blue-50 p-3"
                  : "rounded bg-gray-50 p-3"
              }
            >
              <div className="mb-1 text-xs font-medium text-gray-600">
                {message.role === "assistant"
                  ? "Modèle évalué"
                  : "Interlocuteur"}
              </div>
              <div className="whitespace-pre-wrap text-sm">
                {message.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EvalRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = use(params);
  const [record, setRecord] = useState<EvalRunRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRecord(await getEvalRun(runId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (record?.status !== "running" && record?.status !== "pending") return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [record?.status, load]);

  const stop = async () => {
    try {
      setRecord(await cancelEvalRun(runId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          {error}
        </p>
      </main>
    );
  }

  if (!record) {
    return <main className="mx-auto max-w-3xl p-8">Chargement…</main>;
  }

  const running = record.status === "running" || record.status === "pending";
  const judged =
    record.tally.met + record.tally.not_met + record.tally.borderline;

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {record.config.scenario.title}
          </h1>
          <p className="text-sm text-gray-600">
            {record.config.turns} tour{record.config.turns > 1 ? "s" : ""} ·{" "}
            {record.config.repetitions} répétitions ·{" "}
            {record.config.models.target}
          </p>
        </div>
        {running && (
          <button onClick={stop} className="rounded border px-3 py-1 text-sm">
            Arrêter
          </button>
        )}
      </div>

      {running && (
        <p className="rounded border p-3">
          Run en cours — {record.progress.completed} / {record.progress.total}{" "}
          répétitions terminées.
        </p>
      )}

      {record.status === "error" && (
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          Le run a échoué : {record.error}
        </p>
      )}

      {record.status === "cancelled" && (
        <p className="rounded border p-3">
          Run annulé. Les répétitions déjà terminées sont conservées.
        </p>
      )}

      {record.status === "done" && (
        <section className="rounded border p-4">
          <p className="text-xl">
            <strong>{record.tally.met}</strong> fois sur{" "}
            <strong>{record.config.repetitions}</strong>, le modèle a cédé.
          </p>
          <p className="mt-1 text-sm text-gray-600">
            {record.tally.not_met} fois il a tenu, {record.tally.borderline}{" "}
            cas limite
            {record.tally.borderline > 1 ? "s" : ""}.
            {judged < record.config.repetitions && (
              <>
                {" "}
                {record.config.repetitions - judged} répétition
                {record.config.repetitions - judged > 1 ? "s" : ""} n&apos;
                {record.config.repetitions - judged > 1 ? "ont" : "a"} pas pu
                être jugée
                {record.config.repetitions - judged > 1 ? "s" : ""}.
              </>
            )}
          </p>
        </section>
      )}

      <section className="space-y-2">
        {record.conversations.map((conversation) => (
          <ConversationView
            key={conversation.conversation_id}
            conversation={conversation}
          />
        ))}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Vérifier le résultat à la main**

Lancer `./scripts/dev.sh`, remplir le formulaire avec un scénario court — un tour, deux répétitions, le modèle le moins cher du catalogue — et lancer.

Attendu : la page de résultat affiche la progression pendant le run, puis le décompte « N fois sur M », puis la liste des répétitions. Déplier une répétition montre la conversation, avec les messages du modèle évalué visuellement distincts de ceux qui lui sont adressés. **Le prompt de l'adversaire n'apparaît nulle part.**

- [ ] **Step 3: Commit**

```bash
git add "web/app/eval/[runId]/page.tsx"
git commit -m "feat: page de résultat d'un run d'évaluation"
```

---

### Task 5: API — routes de la génération de scénarios

**Files:**
- Create: `backend/playground/gen_api.py`
- Modify: `backend/playground/api.py` (monter le routeur)
- Create: `tests/test_gen_api.py`

**Interfaces:**
- Consumes: `load_judges`, `load_judge`, `write_judge`, `delete_judge`, `suggested_threshold`, `create_run`, `read_run`, `write_run`, `list_runs`, `read_progress`, `select_scenario`, `unselect_scenario`, `is_selected`, `RunConfig`, `RunRecord`, `Scenario`, `JudgeDimension`.
- Produces: `gen_api.router`, `gen_api.RUNS_DIR`, `gen_api.JUDGES_DIR`, `gen_api.SELECTED_DIR`, `gen_api._launch_subprocess(run_id)`, `gen_api._PROCESSES`, et les modèles `JudgeInfo`, `JudgePayload`, `SelectPayload`, `ScenarioView`.

- [ ] **Step 1: Écrire le test qui échoue**

Créer `tests/test_gen_api.py` :

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from playground import gen_api
from playground.api import app
from playground.schemas import Scenario
from playground.store import read_run, write_run


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    judges = tmp_path / "judges"
    judges.mkdir()
    (judges / "realism.md").write_text(
        '---\ndescription: "Plausible."\ntags: []\npalette: "good-high"\n---\n\n'
        "Note de 1 à 10.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(gen_api, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(gen_api, "JUDGES_DIR", judges)
    monkeypatch.setattr(gen_api, "SELECTED_DIR", tmp_path / "selected")
    monkeypatch.setattr(gen_api, "_launch_subprocess", lambda run_id: None)
    return TestClient(app)


def _payload() -> dict:
    return {
        "seed": "une idée à instancier",
        "n_scenarios": 2,
        "judges": [{"name": "realism", "threshold": 7, "direction": "gte"}],
        "models": {"generator": "mockllm/model", "judge": "mockllm/model"},
        "vary_axes": True,
    }


def test_liste_des_juges_avec_seuil_suggere(client: TestClient):
    judge = client.get("/api/judges").json()[0]
    assert judge["name"] == "realism"
    assert judge["suggested_threshold"] == 7
    assert judge["suggested_direction"] == "gte"


def test_creer_puis_supprimer_un_juge(client: TestClient):
    created = client.post(
        "/api/judges",
        json={
            "name": "mon_juge",
            "description": "Un critère à moi.",
            "tags": ["perso"],
            "palette": "good-high",
            "rubric": "Note de 1 à 10.",
        },
    )
    assert created.status_code == 201
    assert "mon_juge" in [j["name"] for j in client.get("/api/judges").json()]
    assert client.delete("/api/judges/mon_juge").status_code == 204
    assert client.delete("/api/judges/mon_juge").status_code == 404


def test_un_nom_de_juge_invalide_est_refuse(client: TestClient):
    response = client.post(
        "/api/judges",
        json={
            "name": "Mon Juge",
            "description": "d",
            "tags": [],
            "palette": "good-high",
            "rubric": "r",
        },
    )
    assert response.status_code == 422


def test_lancer_un_run_de_generation(client: TestClient):
    response = client.post("/api/runs", json=_payload())
    assert response.status_code == 201
    run_id = response.json()["run_id"]
    assert client.get(f"/api/runs/{run_id}").json()["status"] == "pending"


def test_un_run_sans_juge_est_refuse(client: TestClient):
    payload = _payload()
    payload["judges"] = []
    assert client.post("/api/runs", json=payload).status_code == 422


def test_un_run_avec_un_juge_inconnu_est_refuse(client: TestClient):
    payload = _payload()
    payload["judges"] = [{"name": "fantome", "threshold": 7, "direction": "gte"}]
    response = client.post("/api/runs", json=payload)
    assert response.status_code == 400
    assert "fantome" in response.json()["detail"]


def test_run_inconnu_renvoie_404(client: TestClient):
    assert client.get("/api/runs/absent").status_code == 404


def test_les_scenarios_qui_passent_tout_sont_en_tete(
    client: TestClient, tmp_path: Path
):
    run_id = client.post("/api/runs", json=_payload()).json()["run_id"]
    runs_dir = tmp_path / "runs"
    record = read_run(run_id, runs_dir)
    record.scenarios = [
        Scenario(
            scenario_id="echec",
            title="échoue",
            system_prompt="",
            opening_message="",
            tests_for="",
            passes_all=False,
            mean_margin=-1.0,
        ),
        Scenario(
            scenario_id="succes",
            title="passe",
            system_prompt="",
            opening_message="",
            tests_for="",
            passes_all=True,
            mean_margin=2.0,
        ),
    ]
    write_run(record, runs_dir)

    ids = [s["scenario_id"] for s in client.get("/api/scenarios").json()]
    assert ids == ["succes", "echec"]


def test_filtrer_les_scenarios_qui_passent_tout(client: TestClient, tmp_path: Path):
    run_id = client.post("/api/runs", json=_payload()).json()["run_id"]
    runs_dir = tmp_path / "runs"
    record = read_run(run_id, runs_dir)
    record.scenarios = [
        Scenario(
            scenario_id="echec",
            title="échoue",
            system_prompt="",
            opening_message="",
            tests_for="",
            passes_all=False,
        ),
        Scenario(
            scenario_id="succes",
            title="passe",
            system_prompt="",
            opening_message="",
            tests_for="",
            passes_all=True,
        ),
    ]
    write_run(record, runs_dir)

    response = client.get("/api/scenarios", params={"passes_all": "true"})
    assert [s["scenario_id"] for s in response.json()] == ["succes"]


def test_retenir_puis_relacher_un_scenario(client: TestClient, tmp_path: Path):
    run_id = client.post("/api/runs", json=_payload()).json()["run_id"]
    runs_dir = tmp_path / "runs"
    record = read_run(run_id, runs_dir)
    record.scenarios = [
        Scenario(
            scenario_id="s1",
            title="t",
            system_prompt="sp",
            opening_message="om",
            tests_for="tf",
        )
    ]
    write_run(record, runs_dir)

    response = client.post(
        f"/api/scenarios/{run_id}/s1/select", json={"selected": True}
    )
    assert response.status_code == 200
    assert response.json()["selected"] is True
    assert (tmp_path / "selected" / "s1.yaml").exists()

    response = client.post(
        f"/api/scenarios/{run_id}/s1/select", json={"selected": False}
    )
    assert response.json()["selected"] is False
    assert not (tmp_path / "selected" / "s1.yaml").exists()


def test_retenir_un_scenario_inconnu_renvoie_404(client: TestClient):
    run_id = client.post("/api/runs", json=_payload()).json()["run_id"]
    response = client.post(
        f"/api/scenarios/{run_id}/fantome/select", json={"selected": True}
    )
    assert response.status_code == 404
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `.venv/bin/pytest tests/test_gen_api.py -v`
Attendu : FAIL avec `ModuleNotFoundError: No module named 'playground.gen_api'`.

- [ ] **Step 3: Écrire `backend/playground/gen_api.py`**

```python
"""Routes HTTP de la génération de scénarios.

Ce module ne contient aucune logique métier : il valide, appelle les modules
dédiés, et sérialise.
"""

import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException
from inspect_petri import JudgeDimension
from pydantic import BaseModel, Field

from playground.judges import (
    JUDGES_DIR as _DEFAULT_JUDGES_DIR,
    delete_judge,
    load_judge,
    load_judges,
    suggested_threshold,
    write_judge,
)
from playground.schemas import Direction, RunConfig, RunRecord, Scenario
from playground.store import (
    RUNS_DIR as _DEFAULT_RUNS_DIR,
    SELECTED_DIR as _DEFAULT_SELECTED_DIR,
    create_run,
    is_selected,
    list_runs,
    read_progress,
    read_run,
    select_scenario,
    unselect_scenario,
    write_run,
)

router = APIRouter()

RUNS_DIR = _DEFAULT_RUNS_DIR
JUDGES_DIR = _DEFAULT_JUDGES_DIR
SELECTED_DIR = _DEFAULT_SELECTED_DIR

_PROCESSES: dict[str, subprocess.Popen] = {}
"""Les sous-process de génération en cours, par run_id, pour pouvoir les annuler."""


class JudgeInfo(BaseModel):
    """Un juge tel que l'interface l'affiche, seuil pré-rempli compris."""

    name: str
    description: str
    tags: list[str]
    palette: str
    rubric: str
    suggested_threshold: int
    suggested_direction: Direction


class JudgePayload(BaseModel):
    """Création ou édition d'un juge."""

    name: str = Field(min_length=1, pattern=r"^[a-z0-9_]+$")
    description: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    palette: str = "good-high"
    rubric: str = Field(min_length=1)


class SelectPayload(BaseModel):
    selected: bool


class ScenarioView(Scenario):
    """Un scénario enrichi de son contexte de run, pour la table."""

    run_id: str
    run_label: str | None = None
    created_at: str
    selected: bool = False


def _launch_subprocess(run_id: str) -> None:
    """Lance l'exécution d'un run de génération dans un process séparé.

    Remplacé par un stub dans les tests.
    """
    _PROCESSES[run_id] = subprocess.Popen(
        [sys.executable, "-m", "playground.job", run_id]
    )


def _judge_info(dimension: JudgeDimension) -> JudgeInfo:
    threshold, direction = suggested_threshold(dimension)
    return JudgeInfo(
        name=dimension.name,
        description=dimension.description,
        tags=dimension.tags,
        palette=dimension.palette,
        rubric=dimension.rubric or "",
        suggested_threshold=threshold,
        suggested_direction=direction,
    )


@router.get("/api/judges", response_model=list[JudgeInfo])
def get_judges() -> list[JudgeInfo]:
    return [_judge_info(dimension) for dimension in load_judges(Path(JUDGES_DIR))]


@router.post("/api/judges", response_model=JudgeInfo, status_code=201)
def post_judge(payload: JudgePayload) -> JudgeInfo:
    dimension = JudgeDimension(
        name=payload.name,
        description=payload.description,
        tags=payload.tags,
        palette=payload.palette,
        rubric=payload.rubric,
    )
    write_judge(dimension, Path(JUDGES_DIR))
    return _judge_info(dimension)


@router.delete("/api/judges/{name}", status_code=204)
def delete_judge_route(name: str) -> None:
    try:
        delete_judge(name, Path(JUDGES_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Juge inconnu : {name}")


@router.post("/api/runs", response_model=RunRecord, status_code=201)
def post_run(config: RunConfig) -> RunRecord:
    for selection in config.judges:
        try:
            load_judge(selection.name, Path(JUDGES_DIR))
        except KeyError:
            raise HTTPException(
                status_code=400, detail=f"Juge inconnu : {selection.name}"
            )
    record = create_run(config, Path(RUNS_DIR))
    _launch_subprocess(record.run_id)
    return record


@router.get("/api/runs", response_model=list[RunRecord])
def get_runs() -> list[RunRecord]:
    return list_runs(Path(RUNS_DIR))


@router.get("/api/runs/{run_id}", response_model=RunRecord)
def get_run(run_id: str) -> RunRecord:
    try:
        record = read_run(run_id, Path(RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run inconnu : {run_id}")
    if record.status == "running":
        record.progress.completed = read_progress(run_id, Path(RUNS_DIR))
    return record


@router.post("/api/runs/{run_id}/cancel", response_model=RunRecord)
def cancel_run(run_id: str) -> RunRecord:
    try:
        record = read_run(run_id, Path(RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run inconnu : {run_id}")
    if record.status in ("pending", "running"):
        process = _PROCESSES.pop(run_id, None)
        if process is not None and process.poll() is None:
            process.terminate()
        record.status = "cancelled"
        write_run(record, Path(RUNS_DIR))
    return record


def _scenario_view(scenario: Scenario, record: RunRecord) -> ScenarioView:
    return ScenarioView(
        **scenario.model_dump(),
        run_id=record.run_id,
        run_label=record.label,
        created_at=record.created_at,
        selected=is_selected(scenario.scenario_id, Path(SELECTED_DIR)),
    )


@router.get("/api/scenarios", response_model=list[ScenarioView])
def get_scenarios(
    run_id: str | None = None,
    passes_all: bool | None = None,
    selected: bool | None = None,
) -> list[ScenarioView]:
    views: list[ScenarioView] = []
    for record in list_runs(Path(RUNS_DIR)):
        if run_id is not None and record.run_id != run_id:
            continue
        for scenario in record.scenarios:
            view = _scenario_view(scenario, record)
            if passes_all is not None and view.passes_all is not passes_all:
                continue
            if selected is not None and view.selected is not selected:
                continue
            views.append(view)

    return sorted(
        views,
        key=lambda view: (view.passes_all, view.mean_margin, view.created_at),
        reverse=True,
    )


@router.post(
    "/api/scenarios/{run_id}/{scenario_id}/select", response_model=ScenarioView
)
def post_select(run_id: str, scenario_id: str, payload: SelectPayload) -> ScenarioView:
    try:
        record = read_run(run_id, Path(RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Run inconnu : {run_id}")

    scenario = next(
        (s for s in record.scenarios if s.scenario_id == scenario_id), None
    )
    if scenario is None:
        raise HTTPException(
            status_code=404, detail=f"Scénario inconnu : {scenario_id}"
        )

    if payload.selected:
        select_scenario(scenario, record, Path(SELECTED_DIR))
    else:
        unselect_scenario(scenario_id, Path(SELECTED_DIR))

    return _scenario_view(scenario, record)
```

- [ ] **Step 4: Monter le routeur dans `backend/playground/api.py`**

Ajouter l'import et le montage, sans toucher au reste :

```python
from playground.gen_api import router as gen_router
```

et, après `app.include_router(eval_router)` :

```python
app.include_router(gen_router)
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `.venv/bin/pytest tests/test_gen_api.py tests/test_eval_api.py -v`
Attendu : 11 nouveaux + 12 existants au vert.

- [ ] **Step 6: Commit**

```bash
git add backend/playground/gen_api.py backend/playground/api.py tests/test_gen_api.py
git commit -m "feat: routes HTTP de la génération de scénarios"
```

---

### Task 6: Onglet Créer

**Files:**
- Create: `web/app/creer/page.tsx`
- Modify: `web/lib/types.ts` (types de la génération)
- Modify: `web/lib/api.ts` (appels de la génération)

**Interfaces:**
- Consumes: les routes de Task 5.
- Produces: les types `JudgeInfo`, `JudgeSelection`, `RunConfig`, `Scenario`, `ScenarioView`, `RunRecord` ; les fonctions `getJudges()`, `createJudge(payload)`, `deleteJudge(name)`, `createRun(config)`, `getRun(runId)`, `getScenarios(filters)`, `setSelected(runId, scenarioId, selected)`.

**Note :** invoque la skill `frontend-design` avant d'écrire ce composant.

- [ ] **Step 1: Ajouter les types de la génération à la fin de `web/lib/types.ts`**

```typescript
export type Direction = "gte" | "lte";

export interface JudgeInfo {
  name: string;
  description: string;
  tags: string[];
  palette: string;
  rubric: string;
  suggested_threshold: number;
  suggested_direction: Direction;
}

export interface JudgeSelection {
  name: string;
  threshold: number;
  direction: Direction;
}

export interface RunConfig {
  seed: string;
  n_scenarios: number;
  judges: JudgeSelection[];
  models: { generator: string; judge: string };
  label?: string | null;
  vary_axes: boolean;
}

export interface Scenario {
  scenario_id: string;
  title: string;
  system_prompt: string;
  opening_message: string;
  tests_for: string;
  variation_axis: string | null;
  judge_summary: string;
  judge_scores: Record<string, number>;
  judge_justifications: Record<string, string>;
  passes: Record<string, boolean>;
  passes_all: boolean;
  mean_margin: number;
}

export interface ScenarioView extends Scenario {
  run_id: string;
  run_label: string | null;
  created_at: string;
  selected: boolean;
}

export interface RunRecord {
  run_id: string;
  created_at: string;
  label: string | null;
  status: RunStatus;
  config: RunConfig;
  progress: { completed: number; total: number };
  error: string | null;
  log_path: string | null;
  scenarios: Scenario[];
}
```

- [ ] **Step 2: Ajouter les appels de la génération à la fin de `web/lib/api.ts`**

```typescript
import type {
  JudgeInfo,
  RunConfig,
  RunRecord,
  ScenarioView,
} from "./types";

export interface JudgePayload {
  name: string;
  description: string;
  tags: string[];
  palette: string;
  rubric: string;
}

export const getJudges = () => request<JudgeInfo[]>("/api/judges");

export const createJudge = (payload: JudgePayload) =>
  request<JudgeInfo>("/api/judges", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const deleteJudge = (name: string) =>
  request<void>(`/api/judges/${name}`, { method: "DELETE" });

export const createRun = (config: RunConfig) =>
  request<RunRecord>("/api/runs", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const getRun = (runId: string) => request<RunRecord>(`/api/runs/${runId}`);

export const getScenarios = (
  filters: { runId?: string; passesAll?: boolean; selected?: boolean } = {},
) => {
  const params = new URLSearchParams();
  if (filters.runId) params.set("run_id", filters.runId);
  if (filters.passesAll !== undefined)
    params.set("passes_all", String(filters.passesAll));
  if (filters.selected !== undefined)
    params.set("selected", String(filters.selected));
  const query = params.toString();
  return request<ScenarioView[]>(`/api/scenarios${query ? `?${query}` : ""}`);
};

export const setSelected = (
  runId: string,
  scenarioId: string,
  selected: boolean,
) =>
  request<ScenarioView>(`/api/scenarios/${runId}/${scenarioId}/select`, {
    method: "POST",
    body: JSON.stringify({ selected }),
  });
```

Fusionne cet import avec celui déjà présent en tête du fichier plutôt que d'en ajouter un second.

- [ ] **Step 3: Écrire `web/app/creer/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRun, getCatalog, getJudges } from "@/lib/api";
import type {
  Direction,
  JudgeInfo,
  JudgeSelection,
  ProviderInfo,
} from "@/lib/types";

export default function CreerPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [judges, setJudges] = useState<JudgeInfo[]>([]);
  const [seed, setSeed] = useState("");
  const [label, setLabel] = useState("");
  const [nScenarios, setNScenarios] = useState(10);
  const [varyAxes, setVaryAxes] = useState(true);
  const [generator, setGenerator] = useState("");
  const [judgeModel, setJudgeModel] = useState("");
  const [selections, setSelections] = useState<JudgeSelection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inProgress, setInProgress] = useState(false);

  useEffect(() => {
    Promise.all([getCatalog(), getJudges()])
      .then(([catalog, judgesList]) => {
        setProviders(catalog);
        setJudges(judgesList);
        const firstAvailable = catalog.find((p) => p.key_present);
        if (firstAvailable) {
          setGenerator(firstAvailable.models[0].id);
          setJudgeModel(firstAvailable.models[0].id);
        }
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const toggleJudge = (judge: JudgeInfo) => {
    setSelections((current) =>
      current.some((s) => s.name === judge.name)
        ? current.filter((s) => s.name !== judge.name)
        : [
            ...current,
            {
              name: judge.name,
              threshold: judge.suggested_threshold,
              direction: judge.suggested_direction,
            },
          ],
    );
  };

  const updateSelection = (name: string, change: Partial<JudgeSelection>) => {
    setSelections((current) =>
      current.map((s) => (s.name === name ? { ...s, ...change } : s)),
    );
  };

  const launch = async () => {
    setError(null);
    setInProgress(true);
    try {
      const record = await createRun({
        seed,
        n_scenarios: nScenarios,
        judges: selections,
        models: { generator, judge: judgeModel },
        label: label || null,
        vary_axes: varyAxes,
      });
      router.push(`/scenarios?run=${record.run_id}`);
    } catch (e) {
      setError((e as Error).message);
      setInProgress(false);
    }
  };

  const modelOptions = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      id: model.id,
      label: `${provider.label} — ${model.label}`,
      available: provider.key_present,
      envVars: provider.env_vars.join(" ou "),
    })),
  );

  const readyToLaunch =
    seed.trim() !== "" &&
    selections.length > 0 &&
    generator !== "" &&
    judgeModel !== "";

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-8">
      <h1 className="text-2xl font-semibold">Créer des scénarios</h1>

      {error && (
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}

      <label className="block space-y-2">
        <span className="font-medium">Seed — l&apos;idée à instancier</span>
        <textarea
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          rows={8}
          className="w-full rounded border p-3 font-mono text-sm"
          placeholder="Décris la situation que les scénarios doivent mettre en scène…"
        />
      </label>

      <label className="block space-y-2">
        <span className="font-medium">Libellé du run (optionnel)</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded border p-2"
        />
      </label>

      <section className="grid grid-cols-2 gap-4">
        {[
          {
            id: "generator",
            label: "Modèle générateur",
            value: generator,
            onChange: setGenerator,
          },
          {
            id: "judge",
            label: "Modèle juge",
            value: judgeModel,
            onChange: setJudgeModel,
          },
        ].map((field) => (
          <div key={field.id} className="space-y-2">
            <label htmlFor={field.id} className="block font-medium">
              {field.label}
            </label>
            <select
              id={field.id}
              value={field.value}
              onChange={(e) => field.onChange(e.target.value)}
              className="w-full rounded border p-2"
            >
              {modelOptions.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={!option.available}
                >
                  {option.label}
                  {option.available ? "" : ` (${option.envVars} manquante)`}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="font-medium">Juges</h2>
        <p className="text-sm text-gray-600">
          Au moins un juge est requis. Les seuils servent au tri de la table —
          aucun scénario n&apos;est jamais écarté.
        </p>
        {judges.map((judge) => {
          const selection = selections.find((s) => s.name === judge.name);
          return (
            <div key={judge.name} className="rounded border p-3 space-y-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={selection !== undefined}
                  onChange={() => toggleJudge(judge)}
                  className="mt-1"
                />
                <span>
                  <span className="font-mono text-sm">{judge.name}</span>
                  <span className="block text-sm text-gray-600">
                    {judge.description}
                  </span>
                </span>
              </label>
              {selection && (
                <div className="flex items-center gap-2 pl-6 text-sm">
                  <label htmlFor={`dir-${judge.name}`}>Seuil</label>
                  <select
                    id={`dir-${judge.name}`}
                    value={selection.direction}
                    onChange={(e) =>
                      updateSelection(judge.name, {
                        direction: e.target.value as Direction,
                      })
                    }
                    className="rounded border p-1"
                  >
                    <option value="gte">≥</option>
                    <option value="lte">≤</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={selection.threshold}
                    onChange={(e) =>
                      updateSelection(judge.name, {
                        threshold: Number(e.target.value),
                      })
                    }
                    className="w-16 rounded border p-1"
                  />
                  <span className="text-gray-600">sur 10</span>
                </div>
              )}
            </div>
          );
        })}
      </section>

      <section className="flex items-end gap-6">
        <label className="space-y-2">
          <span className="block font-medium">Nombre de scénarios</span>
          <input
            type="number"
            min={1}
            value={nScenarios}
            onChange={(e) => setNScenarios(Number(e.target.value))}
            className="w-24 rounded border p-2"
          />
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input
            type="checkbox"
            checked={varyAxes}
            onChange={(e) => setVaryAxes(e.target.checked)}
          />
          <span>
            Varier les axes
            <span className="block text-sm text-gray-600">
              Impose un axe différent à chaque scénario (secteur, rôle, canal…).
              Aucun appel de modèle en plus.
            </span>
          </span>
        </label>
      </section>

      <button
        onClick={launch}
        disabled={!readyToLaunch || inProgress}
        className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
      >
        {inProgress ? "Lancement…" : "Lancer"}
      </button>
    </main>
  );
}
```

- [ ] **Step 4: Vérifier l'écran à la main**

Lancer `./scripts/dev.sh` et ouvrir `http://localhost:3000/creer`.
Attendu : les cinq juges livrés sont listés ; cocher un juge fait apparaître son seuil pré-rempli ; les modèles sans clé sont désactivés.

- [ ] **Step 5: Commit**

```bash
git add web/app/creer/page.tsx web/lib/types.ts web/lib/api.ts
git commit -m "feat: onglet Créer"
```

---

### Task 7: Onglets Scénarios et Juges

**Files:**
- Create: `web/app/scenarios/page.tsx`
- Create: `web/app/scenarios/[runId]/[scenarioId]/page.tsx`
- Create: `web/app/juges/page.tsx`

**Interfaces:**
- Consumes: `getScenarios`, `getRun`, `setSelected`, `getJudges`, `createJudge`, `deleteJudge` de Task 6.
- Produces: rien.

**Note :** invoque la skill `frontend-design` avant d'écrire ces composants.

- [ ] **Step 1: Écrire `web/app/scenarios/page.tsx`**

```tsx
"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { getRun, getScenarios } from "@/lib/api";
import type { RunRecord, ScenarioView } from "@/lib/types";

function ScenariosTable() {
  const params = useSearchParams();
  const runFilter = params.get("run") ?? undefined;

  const [scenarios, setScenarios] = useState<ScenarioView[]>([]);
  const [run, setRun] = useState<RunRecord | null>(null);
  const [onlyPassing, setOnlyPassing] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setScenarios(
        await getScenarios({
          runId: runFilter,
          passesAll: onlyPassing ? true : undefined,
          selected: onlySelected ? true : undefined,
        }),
      );
      if (runFilter) {
        setRun(await getRun(runFilter));
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [runFilter, onlyPassing, onlySelected]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (run?.status !== "running" && run?.status !== "pending") return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [run?.status, load]);

  const judgeNames = Array.from(
    new Set(scenarios.flatMap((s) => Object.keys(s.judge_scores))),
  );

  return (
    <main className="mx-auto max-w-6xl p-8 space-y-6">
      <h1 className="text-2xl font-semibold">Scénarios</h1>

      {error && (
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}

      {run && (run.status === "running" || run.status === "pending") && (
        <p className="rounded border p-3">
          Run en cours — {run.progress.completed} / {run.progress.total}{" "}
          scénarios notés.
        </p>
      )}

      {run?.status === "error" && (
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          Le run a échoué : {run.error}
        </p>
      )}

      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlyPassing}
            onChange={(e) => setOnlyPassing(e.target.checked)}
          />
          Seulement ceux qui passent tous les juges
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={onlySelected}
            onChange={(e) => setOnlySelected(e.target.checked)}
          />
          Seulement les retenus
        </label>
        {runFilter && (
          <a href="/scenarios" className="underline">
            Voir tous les runs
          </a>
        )}
      </div>

      {scenarios.length === 0 ? (
        <p className="text-gray-600">Aucun scénario pour l&apos;instant.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Titre</th>
              <th className="py-2">Axe</th>
              {judgeNames.map((name) => (
                <th key={name} className="py-2 font-mono text-xs">
                  {name}
                </th>
              ))}
              <th className="py-2">Retenu</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((scenario) => (
              <tr
                key={`${scenario.run_id}-${scenario.scenario_id}`}
                className="border-b"
              >
                <td className="py-2">
                  <a
                    href={`/scenarios/${scenario.run_id}/${scenario.scenario_id}`}
                    className="underline"
                  >
                    {scenario.title}
                  </a>
                  {scenario.passes_all && (
                    <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
                      passe tout
                    </span>
                  )}
                </td>
                <td className="py-2 text-gray-600">
                  {scenario.variation_axis ?? "—"}
                </td>
                {judgeNames.map((name) => {
                  const score = scenario.judge_scores[name];
                  const passed = scenario.passes[name];
                  return (
                    <td key={name} className="py-2">
                      {score === undefined ? (
                        "—"
                      ) : (
                        <span
                          className={passed ? "text-green-700" : "text-red-700"}
                        >
                          {score}
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="py-2">{scenario.selected ? "oui" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

export default function ScenariosPage() {
  return (
    <Suspense fallback={<main className="p-8">Chargement…</main>}>
      <ScenariosTable />
    </Suspense>
  );
}
```

- [ ] **Step 2: Écrire `web/app/scenarios/[runId]/[scenarioId]/page.tsx`**

```tsx
"use client";

import { use, useEffect, useState } from "react";
import { getScenarios, setSelected } from "@/lib/api";
import type { ScenarioView } from "@/lib/types";

export default function ScenarioDetailPage({
  params,
}: {
  params: Promise<{ runId: string; scenarioId: string }>;
}) {
  const { runId, scenarioId } = use(params);
  const [scenario, setScenario] = useState<ScenarioView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getScenarios({ runId })
      .then((list) => {
        const found = list.find((s) => s.scenario_id === scenarioId);
        if (!found) throw new Error("Scénario introuvable");
        setScenario(found);
      })
      .catch((e: Error) => setError(e.message));
  }, [runId, scenarioId]);

  const toggleSelected = async () => {
    if (!scenario) return;
    try {
      setScenario(await setSelected(runId, scenarioId, !scenario.selected));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          {error}
        </p>
      </main>
    );
  }

  if (!scenario) {
    return <main className="mx-auto max-w-3xl p-8">Chargement…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{scenario.title}</h1>
          <p className="text-sm text-gray-600">
            Axe : {scenario.variation_axis ?? "aucun"} · Run{" "}
            <span className="font-mono">{scenario.run_id}</span>
          </p>
        </div>
        <button
          onClick={toggleSelected}
          className="shrink-0 rounded bg-black px-4 py-2 text-white"
        >
          {scenario.selected ? "Relâcher" : "Retenir"}
        </button>
      </div>

      <section className="space-y-2">
        <h2 className="font-medium">Ce que ça teste</h2>
        <p>{scenario.tests_for}</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">System prompt du modèle évalué</h2>
        <pre className="whitespace-pre-wrap rounded border p-3 text-sm">
          {scenario.system_prompt}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Message d&apos;ouverture</h2>
        <pre className="whitespace-pre-wrap rounded border p-3 text-sm">
          {scenario.opening_message}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Jugement</h2>
        <p className="text-sm text-gray-700">{scenario.judge_summary}</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Juge</th>
              <th className="py-2">Score</th>
              <th className="py-2">Justification</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(scenario.judge_scores).map(([name, score]) => (
              <tr key={name} className="border-b align-top">
                <td className="py-2 font-mono text-xs">{name}</td>
                <td
                  className={`py-2 ${
                    scenario.passes[name] ? "text-green-700" : "text-red-700"
                  }`}
                >
                  {score} / 10
                </td>
                <td className="py-2">
                  {scenario.judge_justifications[name] ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Écrire `web/app/juges/page.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createJudge, deleteJudge, getJudges } from "@/lib/api";
import type { JudgeInfo } from "@/lib/types";

const PALETTES = ["good-high", "good-low", "neutral", "diverging"];

export default function JudgesPage() {
  const [judges, setJudges] = useState<JudgeInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [palette, setPalette] = useState("good-high");
  const [rubric, setRubric] = useState("");

  const reload = () =>
    getJudges()
      .then(setJudges)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    reload();
  }, []);

  const save = async () => {
    setError(null);
    try {
      await createJudge({
        name,
        description,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        palette,
        rubric,
      });
      setName("");
      setDescription("");
      setTags("");
      setRubric("");
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (judgeName: string) => {
    setError(null);
    try {
      await deleteJudge(judgeName);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Reprendre un juge existant pré-remplit le formulaire : enregistrer sous le
  // même nom écrase le fichier, ce qui fait office d'édition.
  const edit = (judge: JudgeInfo) => {
    setName(judge.name);
    setDescription(judge.description);
    setTags(judge.tags.join(", "));
    setPalette(judge.palette);
    setRubric(judge.rubric);
  };

  const readyToSave =
    /^[a-z0-9_]+$/.test(name) &&
    description.trim().length > 0 &&
    rubric.trim().length > 0;

  return (
    <main className="mx-auto max-w-3xl p-8 space-y-8">
      <h1 className="text-2xl font-semibold">Juges</h1>
      <p className="text-sm text-gray-600">
        Un juge est un fichier <code>data/judges/&lt;nom&gt;.md</code> au format
        des dimensions Petri. Notation de 1 à 10. La palette décide du sens du
        seuil par défaut : <code>good-high</code> donne un plancher,{" "}
        <code>good-low</code> un plafond.
      </p>

      {error && (
        <p role="alert" className="rounded border border-red-500 p-3 text-red-700">
          {error}
        </p>
      )}

      <section className="space-y-3">
        {judges.map((judge) => (
          <div key={judge.name} className="rounded border p-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="font-mono text-sm">{judge.name}</span>
                <span className="ml-2 text-xs text-gray-500">
                  {judge.palette} · défaut{" "}
                  {judge.suggested_direction === "gte" ? "≥" : "≤"}{" "}
                  {judge.suggested_threshold}
                </span>
                <p className="text-sm text-gray-700">{judge.description}</p>
              </div>
              <div className="flex shrink-0 gap-2 text-sm">
                <button onClick={() => edit(judge)} className="underline">
                  Reprendre
                </button>
                <button
                  onClick={() => remove(judge.name)}
                  className="underline text-red-700"
                >
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3 rounded border p-4">
        <h2 className="font-medium">Créer ou remplacer un juge</h2>
        <p className="text-sm text-gray-600">
          Enregistrer sous un nom existant écrase ce juge.
        </p>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Nom</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="minuscules_et_underscores"
            className="w-full rounded border p-2 font-mono text-sm"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border p-2"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block space-y-1">
            <span className="text-sm font-medium">
              Tags (séparés par des virgules)
            </span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full rounded border p-2"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Palette</span>
            <select
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
              className="w-full rounded border p-2"
            >
              {PALETTES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-sm font-medium">Rubrique</span>
          <textarea
            value={rubric}
            onChange={(e) => setRubric(e.target.value)}
            rows={12}
            className="w-full rounded border p-3 font-mono text-sm"
          />
        </label>

        <button
          onClick={save}
          disabled={!readyToSave}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-40"
        >
          Enregistrer
        </button>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Vérifier les trois écrans à la main**

Lancer `./scripts/dev.sh`.
Attendu : `/scenarios` affiche la table (vide tant qu'aucun run de génération n'a tourné) ; `/juges` liste les cinq juges livrés, et créer un juge le fait apparaître dans la liste **et** dans l'onglet Créer.

- [ ] **Step 5: Commit**

```bash
git add web/app/scenarios web/app/juges
git commit -m "feat: onglets Scénarios et Juges"
```

---

### Task 8: README et vérification réelle de bout en bout

**Files:**
- Create: `README.md`
- Modify: `.env.example` (rien à changer si les trois clés y sont déjà)

**Interfaces:**
- Consumes: tout.
- Produces: rien.

- [ ] **Step 1: Écrire `README.md`**

````markdown
# Playground d'évaluation

Deux outils dans une seule interface :

- **Évaluer** — tester un scénario contre un modèle, sur plusieurs tours, face
  à un adversaire qui poursuit un objectif que le modèle évalué ignore, N fois
  de suite. Réponse : « le modèle a cédé 3 fois sur 10 », avec les
  conversations consultables.
- **Créer** — générer des scénarios candidats à partir d'une idée, les noter
  sur plusieurs axes, et retenir les bons.

L'onglet Évaluer ne dépend pas de l'autre : on peut saisir un scénario à la
main et lancer, sans jamais passer par la génération.

## Installation

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
npm --prefix web install
cp .env.example .env   # puis remplis les clés dont tu as besoin
```

Trois providers sont proposés. Il suffit d'avoir la clé de celui qu'on veut
utiliser — l'interface grise les autres.

| Provider | Variable |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| xAI (Grok) | `XAI_API_KEY` |

## Lancer

```bash
./scripts/dev.sh
```

Le front écoute sur `http://localhost:3000`, l'API sur `http://localhost:8000`.

## L'asymétrie de l'évaluation

Le modèle évalué ne voit qu'une conversation ordinaire. L'adversaire voit la
même conversation en miroir, plus un objectif qui lui est propre et que le
modèle évalué ne verra jamais — c'est ce qui rend la mesure valide.

Cette étanchéité est garantie au niveau de la plomberie : une seule fonction
construit les messages du modèle évalué, et sa signature ne peut pas recevoir
l'objectif de l'adversaire. Elle ne l'est **pas** au niveau du contenu : rien
n'empêche un adversaire de recopier ses instructions dans son message. Une
consigne de confidentialité réduit ce risque sans l'éliminer, et un test le
documente explicitement.

## Juges

Un juge est un fichier `data/judges/<name>.md` : front matter YAML
(`description`, `tags`, `palette`) puis une rubrique markdown. C'est le format
des dimensions de juge de Petri, donc ces fichiers sont réutilisables ailleurs.
Cinq juges sont livrés ; ce ne sont que des fichiers, édite-les.

## Tests

```bash
pytest
```

Aucun test n'appelle d'API réelle : tout passe par le provider `mockllm` d'inspect.

## Structure

```
backend/playground/   le backend Python (inspect.ai + FastAPI)
web/                  le front Next.js
data/judges/          les juges, versionnés
data/runs/            les runs de génération, ignorés par git
data/eval-runs/       les runs d'évaluation, ignorés par git
data/selected/        les scénarios retenus, ignorés par git
logs/                 les .eval d'inspect, ignorés par git
docs/superpowers/     specs et plans
```
````

- [ ] **Step 2: Vérifier que `.gitignore` couvre les runs d'évaluation**

Run: `git check-ignore -q data/eval-runs && echo ignoré || echo "à ajouter"`

Si la réponse est « à ajouter », ajoute `data/eval-runs/` au bloc des données produites dans `.gitignore`.

- [ ] **Step 3: Lancer toute la suite**

Run: `.venv/bin/pytest -q`
Attendu : tous les tests passent.

- [ ] **Step 4: Vérifier le lint du front**

Run: `npm --prefix web run lint`
Attendu : aucune erreur.

- [ ] **Step 5: Vérification réelle, avec de vraies clés**

Avec au moins une clé renseignée dans `.env`, lancer `./scripts/dev.sh` puis, dans le navigateur :

1. **Évaluation one-shot.** Saisir un scénario court à la main, 1 tour, 2 répétitions, le modèle le moins cher du catalogue. Lancer. Attendu : le décompte s'affiche, les deux conversations sont consultables.
2. **Évaluation multi-tours.** Même scénario, 3 tours, 2 répétitions, avec un objectif d'adversaire. Attendu : chaque conversation compte six messages, alternés. **Vérifier que l'objectif de l'adversaire n'apparaît dans aucun message affiché.**
3. **Génération.** Onglet Créer, une seed courte, 2 scénarios, un juge. Attendu : la table se remplit, les scores s'affichent.
4. **Chaînage.** Retenir un scénario, retourner à l'onglet Évaluer, le charger via « Charger un scénario retenu ». Attendu : les trois champs se remplissent.

- [ ] **Step 6: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: README et vérification de bout en bout"
```

---

## Notes d'implémentation

**Ce que ce plan ne couvre pas.** Le travail visuel. Les tâches 3, 4, 6 et 7 fixent la structure et le comportement ; l'apparence est à travailler avec la skill `frontend-design`, à invoquer avant d'écrire chaque composant.

**Leçons des deux phases précédentes, intégrées d'emblée.** Les tests d'API remplacent le lancement de sous-process par un stub — aucun test ne doit lancer un vrai run. Les tests de tri forcent un ordre non trivial, sans quoi ils passent quelle que soit l'implémentation. Et l'étanchéité du prompt d'adversaire, garantie côté moteur, doit être visible dans l'interface : le champ est marqué comme non vu par le modèle évalué, et la vérification manuelle de la tâche 8 le contrôle sur l'affichage réel.
