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
