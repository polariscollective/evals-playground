"""Stockage des runs d'évaluation : un JSON par run dans `data/eval-runs/`.

Les mécaniques d'écriture atomique, de lecture tolérante et de comptage sont
celles de `store.py`, déjà relues et corrigées en phase 1 : elles sont
réutilisées, pas réécrites.
"""

from datetime import datetime, timezone
from pathlib import Path

from playground.eval_schemas import EvalProgress, EvalRunConfig, EvalRunRecord
from playground.store import (
    bump_counter,
    new_run_id,
    read_counter,
    read_json_records,
    write_json_atomic,
)

EVAL_RUNS_DIR = Path("data/eval-runs")


def _run_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.json"


def _progress_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.progress"


def create_eval_run(
    config: EvalRunConfig, runs_dir: Path = EVAL_RUNS_DIR
) -> EvalRunRecord:
    """Crée un run d'évaluation en attente et l'écrit immédiatement."""
    record = EvalRunRecord(
        run_id=new_run_id(),
        created_at=datetime.now(timezone.utc).isoformat(),
        label=config.label,
        status="pending",
        config=config,
        progress=EvalProgress(completed=0, total=config.repetitions),
    )
    write_eval_run(record, runs_dir)
    return record


def write_eval_run(record: EvalRunRecord, runs_dir: Path = EVAL_RUNS_DIR) -> None:
    """Écrit un run d'évaluation, en remplaçant la version précédente."""
    write_json_atomic(
        _run_path(record.run_id, runs_dir), record.model_dump_json(indent=2)
    )


def read_eval_run(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> EvalRunRecord:
    """Relit un run d'évaluation.

    Raises:
        KeyError: si le run n'existe pas.
    """
    path = _run_path(run_id, runs_dir)
    if not path.exists():
        raise KeyError(f"Run d'évaluation inconnu : {run_id!r}")
    return EvalRunRecord.model_validate_json(path.read_text(encoding="utf-8"))


def list_eval_runs(runs_dir: Path = EVAL_RUNS_DIR) -> list[EvalRunRecord]:
    """Tous les runs d'évaluation, du plus récent au plus ancien."""
    return sorted(
        read_json_records(runs_dir, EvalRunRecord),
        key=lambda record: record.created_at,
        reverse=True,
    )


def bump_eval_progress(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> None:
    """Signale qu'une répétition de plus est terminée."""
    bump_counter(_progress_path(run_id, runs_dir))


def read_eval_progress(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> int:
    """Nombre de répétitions terminées d'après le fichier compteur."""
    return read_counter(_progress_path(run_id, runs_dir))
