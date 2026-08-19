"""Stockage des runs d'évaluation : un JSON par run dans `data/eval-runs/`.

Les mécaniques d'écriture atomique, de lecture tolérante et de comptage sont
celles de `store.py`, déjà relues et corrigées en phase 1 : elles sont
réutilisées, pas réécrites.
"""

from datetime import datetime, timezone
from pathlib import Path

from playground.eval_schemas import (
    EvalProgress,
    EvalRunConfig,
    EvalRunRecord,
    RejudgeRequest,
)
from playground.migrations import load_eval_run
from playground.store import (
    bump_counter,
    new_run_id,
    read_counter,
    write_json_atomic,
)

EVAL_RUNS_DIR = Path("data/eval-runs")


def _run_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.json"


def _progress_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.progress"


def _source_csv_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.csv"


def write_source_csv(run_id: str, content: str, runs_dir: Path = EVAL_RUNS_DIR) -> None:
    """Conserve le CSV téléversé à côté du run.

    Les scénarios sont déjà dans le record, mais pas le fichier : sans lui, on
    ne peut ni le retélécharger, ni relancer le run depuis la même source avec
    le même découpage de colonnes.
    """
    runs_dir.mkdir(parents=True, exist_ok=True)
    _source_csv_path(run_id, runs_dir).write_text(content, encoding="utf-8")


def read_source_csv(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> str | None:
    """Le CSV d'origine d'un run, ou `None` s'il n'en a pas été conservé.

    Les runs antérieurs à cette conservation n'en ont aucun : c'est une absence
    normale, pas une erreur.
    """
    path = _source_csv_path(run_id, runs_dir)
    return path.read_text(encoding="utf-8") if path.exists() else None


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
        # Le commentaire écrit dans le formulaire suit le run dès sa création :
        # c'est le même champ que celui qu'on modifiera ensuite sur sa page.
        notes=config.notes,
        progress=EvalProgress(
            completed=0,
            # La matrice entière : un run produit une conversation par
            # triplet scénario x modèle évalué x répétition.
            total=len(config.scenarios)
            * len(config.models.targets)
            * config.repetitions,
        ),
    )
    write_eval_run(record, runs_dir)
    return record


def write_eval_run(record: EvalRunRecord, runs_dir: Path = EVAL_RUNS_DIR) -> None:
    """Écrit un run d'évaluation, en remplaçant la version précédente.

    `source_csv_available` est exclu : il décrit l'état du disque au moment de
    la lecture. L'enregistrer en ferait une affirmation qui survivrait à la
    disparition du fichier qu'elle décrit.
    """
    write_json_atomic(
        _run_path(record.run_id, runs_dir),
        record.model_dump_json(indent=2, exclude={"source_csv_available"}),
    )


def read_eval_run(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> EvalRunRecord:
    """Relit un run d'évaluation.

    Raises:
        KeyError: si le run n'existe pas.
    """
    path = _run_path(run_id, runs_dir)
    if not path.exists():
        raise KeyError(f"Unknown evaluation run: {run_id!r}")
    record = load_eval_run(path.read_text(encoding="utf-8"))
    record.source_csv_available = _source_csv_path(run_id, runs_dir).exists()
    return record


def list_eval_runs(runs_dir: Path = EVAL_RUNS_DIR) -> list[EvalRunRecord]:
    """Tous les runs d'évaluation, du plus récent au plus ancien.

    Un fichier illisible est ignoré plutôt que de faire échouer la liste
    entière : `ValueError` couvre un JSON malformé comme un record qu'aucune
    migration ne rattrape. Un seul run abîmé ne doit pas rendre l'interface
    inutilisable.
    """
    if not runs_dir.is_dir():
        return []
    records: list[EvalRunRecord] = []
    for path in runs_dir.glob("*.json"):
        try:
            record = load_eval_run(path.read_text(encoding="utf-8"))
        except ValueError:
            continue
        record.source_csv_available = _source_csv_path(
            record.run_id, runs_dir
        ).exists()
        records.append(record)
    return sorted(records, key=lambda record: record.created_at, reverse=True)


def _rejudge_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.rejudge.json"


def write_rejudge_request(
    request: RejudgeRequest, run_id: str, runs_dir: Path = EVAL_RUNS_DIR
) -> None:
    """Dépose la demande de passe de juge que le sous-process ira lire.

    Passe par un fichier plutôt que par la configuration du run : tant que la
    passe n'a pas abouti, le run doit continuer de décrire la question qui a
    réellement produit ses notes.
    """
    write_json_atomic(_rejudge_path(run_id, runs_dir), request.model_dump_json(indent=2))


def read_rejudge_request(
    run_id: str, runs_dir: Path = EVAL_RUNS_DIR
) -> RejudgeRequest:
    """Relit la demande de passe de juge en attente.

    Raises:
        KeyError: si aucune passe n'est en attente pour ce run.
    """
    path = _rejudge_path(run_id, runs_dir)
    if not path.exists():
        raise KeyError(f"No judging pass pending for run {run_id!r}")
    return RejudgeRequest.model_validate_json(path.read_text(encoding="utf-8"))


def clear_rejudge_request(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> None:
    """Retire la demande de passe de juge. Sans effet s'il n'y en avait pas."""
    _rejudge_path(run_id, runs_dir).unlink(missing_ok=True)


def reset_eval_progress(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> None:
    """Remet le compteur de progression à zéro.

    Une passe de juge rejouée recommence le décompte : sans cette remise à
    zéro, la barre partirait du total de la passe précédente et n'avancerait
    plus jamais.
    """
    _progress_path(run_id, runs_dir).unlink(missing_ok=True)


def bump_eval_progress(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> None:
    """Signale qu'une répétition de plus est terminée."""
    bump_counter(_progress_path(run_id, runs_dir))


def read_eval_progress(run_id: str, runs_dir: Path = EVAL_RUNS_DIR) -> int:
    """Nombre de répétitions terminées d'après le fichier compteur."""
    return read_counter(_progress_path(run_id, runs_dir))
