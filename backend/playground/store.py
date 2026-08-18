"""Stockage sur disque : un JSON par run, un YAML par scénario retenu.

Pas de base de données. Un run tient dans un fichier parce que les scénarios
sont petits (quelques kilo-octets), contrairement à des transcripts d'audit.

L'état « retenu » n'est écrit nulle part dans le record du run : la seule source
de vérité est l'existence du fichier dans `data/selected/`. Un scénario retenu
survit donc à la suppression de son run.
"""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

import yaml

from playground.schemas import RunConfig, RunProgress, RunRecord, Scenario

RUNS_DIR = Path("data/runs")
SELECTED_DIR = Path("data/selected")


def new_run_id() -> str:
    """Un identifiant de run court et unique."""
    return uuid.uuid4().hex[:12]


def _run_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.json"


def _progress_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.progress"


def create_run(config: RunConfig, runs_dir: Path = RUNS_DIR) -> RunRecord:
    """Crée un run en attente et l'écrit immédiatement sur disque."""
    record = RunRecord(
        run_id=new_run_id(),
        created_at=datetime.now(timezone.utc).isoformat(),
        label=config.label,
        status="pending",
        config=config,
        progress=RunProgress(completed=0, total=config.n_scenarios),
    )
    write_run(record, runs_dir)
    return record


def write_run(record: RunRecord, runs_dir: Path = RUNS_DIR) -> None:
    """Écrit un run, en remplaçant la version précédente.

    L'écriture passe par un fichier temporaire puis un `replace` atomique : le
    front poll ce fichier pendant qu'un sous-process l'écrit, et ne doit jamais
    lire un JSON tronqué.
    """
    runs_dir.mkdir(parents=True, exist_ok=True)
    destination = _run_path(record.run_id, runs_dir)
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(
        record.model_dump_json(indent=2), encoding="utf-8"
    )
    temporary.replace(destination)


def read_run(run_id: str, runs_dir: Path = RUNS_DIR) -> RunRecord:
    """Relit un run.

    Raises:
        KeyError: si le run n'existe pas.
    """
    path = _run_path(run_id, runs_dir)
    if not path.exists():
        raise KeyError(f"Run inconnu : {run_id!r}")
    return RunRecord.model_validate_json(path.read_text(encoding="utf-8"))


def list_runs(runs_dir: Path = RUNS_DIR) -> list[RunRecord]:
    """Tous les runs, du plus récent au plus ancien.

    Un fichier illisible est ignoré plutôt que de faire échouer la liste
    entière : un run interrompu ne doit pas rendre l'interface inutilisable.
    """
    if not runs_dir.is_dir():
        return []
    records: list[RunRecord] = []
    for path in runs_dir.glob("*.json"):
        try:
            records.append(
                RunRecord.model_validate_json(path.read_text(encoding="utf-8"))
            )
        except (json.JSONDecodeError, ValueError):
            continue
    return sorted(records, key=lambda record: record.created_at, reverse=True)


def bump_progress(run_id: str, runs_dir: Path = RUNS_DIR) -> None:
    """Signale qu'un scénario de plus est terminé.

    Une ligne est ajoutée à un fichier compteur plutôt que de réécrire le
    record : les samples inspect se terminent en parallèle, et des ajouts courts
    en mode `append` ne se marchent pas dessus.
    """
    runs_dir.mkdir(parents=True, exist_ok=True)
    with _progress_path(run_id, runs_dir).open("a", encoding="utf-8") as counter:
        counter.write("1\n")


def read_progress(run_id: str, runs_dir: Path = RUNS_DIR) -> int:
    """Nombre de scénarios terminés d'après le fichier compteur."""
    path = _progress_path(run_id, runs_dir)
    if not path.exists():
        return 0
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line)


def select_scenario(
    scenario: Scenario, record: RunRecord, selected_dir: Path = SELECTED_DIR
) -> Path:
    """Fige un scénario retenu, avec sa traçabilité, dans un YAML autonome."""
    selected_dir.mkdir(parents=True, exist_ok=True)
    content = {
        "scenario_id": scenario.scenario_id,
        "title": scenario.title,
        "system_prompt": scenario.system_prompt,
        "opening_message": scenario.opening_message,
        "tests_for": scenario.tests_for,
        "seed": record.config.seed,
        "variation_axis": scenario.variation_axis,
        "judge_scores": scenario.judge_scores,
        "source": {
            "run_id": record.run_id,
            "generator": record.config.models.generator,
            "judge": record.config.models.judge,
            "created_at": record.created_at,
        },
    }
    path = selected_dir / f"{scenario.scenario_id}.yaml"
    path.write_text(
        yaml.safe_dump(content, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    return path


def unselect_scenario(scenario_id: str, selected_dir: Path = SELECTED_DIR) -> None:
    """Relâche un scénario retenu. Sans effet s'il ne l'était pas."""
    path = selected_dir / f"{scenario_id}.yaml"
    path.unlink(missing_ok=True)


def is_selected(scenario_id: str, selected_dir: Path = SELECTED_DIR) -> bool:
    """Le scénario est-il retenu."""
    return (selected_dir / f"{scenario_id}.yaml").exists()
