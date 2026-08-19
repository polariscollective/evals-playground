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

from playground.eval_schemas import (
    EvalRunConfig,
    EvalRunRecord,
    RejudgeRequest,
    RubricLevel,
)
from playground.eval_store import (
    EVAL_RUNS_DIR as _DEFAULT_EVAL_RUNS_DIR,
    create_eval_run,
    list_eval_runs,
    read_eval_progress,
    read_eval_run,
    read_source_csv,
    reset_eval_progress,
    write_eval_run,
    write_rejudge_request,
    write_source_csv,
)
from playground.exports import details_csv, matrix_csv
from playground.pricing import CostEstimate, estimate_cost
from playground.scoring import JUDGE_SYSTEM, render_transcript, score_prompt
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


class JudgePromptRequest(BaseModel):
    criterion: str = ""
    rubric: list[RubricLevel] = []


class JudgePromptPreview(BaseModel):
    """Le prompt exact que recevra le juge, pour que rien ne reste caché."""

    system_message: str
    user_message: str


class EvalRunLaunch(BaseModel):
    """Ce qu'envoie le formulaire pour lancer un run.

    Le CSV téléversé voyage à côté de la configuration plutôt que dedans : il
    est conservé en fichier, et le faire entrer dans le record ferait grossir
    chaque lecture de run de tout le lot de scénarios une seconde fois.
    """

    config: EvalRunConfig
    csv_text: str | None = None


def _launch_eval_subprocess(run_id: str) -> None:
    """Lance l'exécution d'un run d'évaluation dans un process séparé.

    Sur macOS, la commande est enveloppée dans `caffeinate -i` : une matrice
    peut tourner longtemps, et la mise en veille de la machine interromprait le
    sous-process, laissant le run bloqué en cours pour toujours. `-i` empêche
    seulement la veille système, pas l'extinction de l'écran.

    Remplacé par un stub dans les tests : rien de ce module ne doit lancer un
    vrai run pendant la suite.
    """
    _launch_subprocess("playground.eval_job", run_id)


def _launch_subprocess(module: str, run_id: str) -> None:
    """Lance un module du paquet sur un run, dans un process séparé."""
    command = [sys.executable, "-m", module, run_id]
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

    L'utilisateur écrit une question et des paliers qui atterrissent dans un
    prompt qu'il ne voit pas. Lui montrer ce prompt est le seul moyen qu'il
    comprenne ce que son texte va produire.
    """
    transcript = render_transcript(
        [
            {"role": "user", "content": "…the conversation being judged…"},
            {"role": "assistant", "content": "…the evaluated model's reply…"},
        ]
    )
    return JudgePromptPreview(
        system_message=JUDGE_SYSTEM,
        user_message=score_prompt(transcript, request.criterion, request.rubric),
    )


@router.post("/api/eval-runs", response_model=EvalRunRecord, status_code=201)
def post_eval_run(launch: EvalRunLaunch) -> EvalRunRecord:
    record = create_eval_run(launch.config, Path(EVAL_RUNS_DIR))
    if launch.csv_text is not None:
        # Conservé avant le lancement : c'est ce qui permettra de retélécharger
        # le lot et de relancer le run depuis la même source.
        write_source_csv(record.run_id, launch.csv_text, Path(EVAL_RUNS_DIR))
        record.source_csv_available = True
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


@router.get("/api/eval-runs/{run_id}/source.csv")
def get_source_csv(run_id: str) -> PlainTextResponse:
    """Le CSV téléversé au lancement, tel quel.

    Un 404 pour les runs lancés avant que ce fichier ne soit conservé : c'est
    une absence, pas une panne, et l'interface ne propose le lien que lorsque
    le fichier existe.
    """
    _run_for_export(run_id)
    content = read_source_csv(run_id, Path(EVAL_RUNS_DIR))
    if content is None:
        raise HTTPException(
            status_code=404,
            detail=f"No source CSV was kept for run {run_id}.",
        )
    return _csv_response(content, f"source-{run_id}.csv")


@router.post("/api/eval-runs/{run_id}/rejudge", response_model=EvalRunRecord)
def post_rejudge(run_id: str, request: RejudgeRequest) -> EvalRunRecord:
    """Rejoue le juge sur toutes les conversations d'un run.

    La question et l'échelle demandées attendent sur disque : c'est le
    sous-process qui les fera entrer dans la configuration du run, et seulement
    si la passe aboutit. Un run dont la passe échoue reste décrit par la
    question qui a réellement produit ses notes.

    Le statut passe à `running` ici plutôt qu'au démarrage du sous-process :
    entre les deux, l'interface interrogerait un run encore marqué terminé et
    afficherait des notes que l'on vient de décider de remplacer.
    """
    try:
        record = read_eval_run(run_id, Path(EVAL_RUNS_DIR))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown run: {run_id}")

    if record.status in ("pending", "running"):
        raise HTTPException(
            status_code=409,
            detail="This run is still going. Wait for it to finish, or stop it.",
        )
    if not record.conversations:
        raise HTTPException(
            status_code=409,
            detail="This run has no conversation to judge.",
        )

    write_rejudge_request(request, run_id, Path(EVAL_RUNS_DIR))
    reset_eval_progress(run_id, Path(EVAL_RUNS_DIR))
    record.status = "running"
    record.error = None
    record.progress.completed = 0
    record.progress.total = len(record.conversations)
    write_eval_run(record, Path(EVAL_RUNS_DIR))

    _launch_subprocess("playground.rejudge_job", run_id)
    return record


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
