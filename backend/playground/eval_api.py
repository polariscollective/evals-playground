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
from fastapi.responses import PlainTextResponse
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
from playground.exports import details_csv, matrix_csv
from playground.pricing import CostEstimate, estimate_cost
from playground.store import SELECTED_DIR as _DEFAULT_SELECTED_DIR
from playground.verdict import JUDGE_SYSTEM, render_transcript, verdict_prompt

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


class JudgePromptRequest(BaseModel):
    criterion: str = ""


class JudgePromptPreview(BaseModel):
    """Le prompt exact que recevra le juge, pour que rien ne reste caché."""

    system_message: str
    user_message: str


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


@router.post("/api/judge-prompt-preview", response_model=JudgePromptPreview)
def post_judge_prompt_preview(request: JudgePromptRequest) -> JudgePromptPreview:
    """Rend le prompt du juge visible avant de lancer un run.

    L'utilisateur remplit un critère qui atterrit dans un prompt qu'il ne voit
    pas. Lui montrer ce prompt est le seul moyen qu'il comprenne ce que son
    texte va produire — en particulier que `met` signifie que le comportement
    décrit s'est produit.
    """
    transcript = render_transcript(
        [
            {"role": "user", "content": "…the conversation being judged…"},
            {"role": "assistant", "content": "…the evaluated model's reply…"},
        ]
    )
    return JudgePromptPreview(
        system_message=JUDGE_SYSTEM,
        user_message=verdict_prompt(transcript, request.criterion),
    )


@router.post("/api/eval-runs", response_model=EvalRunRecord, status_code=201)
def post_eval_run(config: EvalRunConfig) -> EvalRunRecord:
    record = create_eval_run(config, Path(EVAL_RUNS_DIR))
    _launch_eval_subprocess(record.run_id)
    return record


@router.post("/api/eval-runs/estimate", response_model=CostEstimate)
def post_estimate(
    config: EvalRunConfig, response_tokens: int | None = None
) -> CostEstimate:
    """Estime le coût d'un run sans rien lancer.

    Même schéma d'entrée que le lancement : l'interface peut donc estimer
    exactement ce qu'elle s'apprête à envoyer, sans transformation
    intermédiaire susceptible de diverger.

    Args:
        response_tokens: Longueur moyenne supposée d'une réponse. Réglable
            depuis le formulaire : c'est l'inconnue dominante, et elle varie
            d'un facteur quarante selon le modèle évalué.
    """
    return estimate_cost(config, response_tokens)


@router.get("/api/eval-runs", response_model=list[EvalRunRecord])
def get_eval_runs() -> list[EvalRunRecord]:
    return list_eval_runs(Path(EVAL_RUNS_DIR))


@router.get("/api/eval-runs/{run_id}", response_model=EvalRunRecord)
def get_eval_run(run_id: str) -> EvalRunRecord:
    try:
        record = read_eval_run(run_id, Path(EVAL_RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown run: {run_id}")
    if record.status == "running":
        record.progress.completed = read_eval_progress(run_id, Path(EVAL_RUNS_DIR))
    elif record.status in ("done", "error", "cancelled"):
        # Le sous-process écrit lui-même son résultat pour un run qui va au
        # bout : rien n'appelle cancel_eval_run dans ce cas, donc c'est ici,
        # à la prochaine lecture, que l'on constate le statut terminal et que
        # le handle laissé dans _EVAL_PROCESSES est purgé.
        _EVAL_PROCESSES.pop(run_id, None)
    return record


class NotesUpdate(BaseModel):
    notes: str


@router.put("/api/eval-runs/{run_id}/notes", response_model=EvalRunRecord)
def put_eval_run_notes(run_id: str, update: NotesUpdate) -> EvalRunRecord:
    """Remplace les notes d'un run.

    Relit le record avant d'écrire : un run en cours est réécrit par son
    sous-process, et sauvegarder une copie devenue périmée effacerait les
    conversations arrivées entre-temps.
    """
    try:
        record = read_eval_run(run_id, Path(EVAL_RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown run: {run_id}")
    record.notes = update.notes
    write_eval_run(record, Path(EVAL_RUNS_DIR))
    return record


def _csv_response(body: str, filename: str) -> PlainTextResponse:
    """Un CSV que le navigateur enregistre au lieu de l'afficher.

    Le BOM UTF-8 est là pour Excel, qui sans lui lit les accents en latin-1 et
    affiche « Accès données » en mojibake.
    """
    return PlainTextResponse(
        content="\ufeff" + body,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _run_for_export(run_id: str) -> EvalRunRecord:
    try:
        return read_eval_run(run_id, Path(EVAL_RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown run: {run_id}")


@router.get("/api/eval-runs/{run_id}/export/matrix.csv")
def get_matrix_csv(run_id: str) -> PlainTextResponse:
    """La matrice telle qu'affichée."""
    record = _run_for_export(run_id)
    return _csv_response(matrix_csv(record), f"matrix-{run_id}.csv")


@router.get("/api/eval-runs/{run_id}/export/details.csv")
def get_details_csv(run_id: str) -> PlainTextResponse:
    """Une ligne par conversation, transcript et paramètres d'entrée compris."""
    record = _run_for_export(run_id)
    return _csv_response(details_csv(record), f"details-{run_id}.csv")


@router.post("/api/eval-runs/{run_id}/cancel", response_model=EvalRunRecord)
def cancel_eval_run(run_id: str) -> EvalRunRecord:
    try:
        record = read_eval_run(run_id, Path(EVAL_RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown run: {run_id}")
    if record.status in ("pending", "running"):
        process = _EVAL_PROCESSES.pop(run_id, None)
        if process is not None and process.poll() is None:
            process.terminate()
        # Comme dans eval_job.py quand inspect termine lui-même sur un statut
        # d'annulation : on capture la progression réelle depuis le compteur
        # avant d'écraser le statut, pour ne pas figer un run interrompu à
        # zéro pour toujours.
        record.progress.completed = read_eval_progress(run_id, Path(EVAL_RUNS_DIR))
        record.status = "cancelled"
        write_eval_run(record, Path(EVAL_RUNS_DIR))
    return record
