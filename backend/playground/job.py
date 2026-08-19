"""Exécution d'un run, en sous-process.

`inspect_ai.eval()` ouvre sa propre boucle asyncio et bloque jusqu'à la fin. Le
lancer dans un process séparé garde l'API réactive, rend l'annulation triviale
et isole un plantage d'inspect du serveur.

Entrypoint : `python -m playground.job <run_id>`.
"""

import sys
import traceback
from pathlib import Path
from typing import Any

from inspect_ai import Task, eval as inspect_eval
from inspect_ai.log import EvalLog
from inspect_ai.solver import system_message

from playground.generation import GENERATION_SYSTEM, generation_dataset, scenario_solver
from playground.judges import JUDGES_DIR, load_judge
from playground.judging import scenario_judge
from playground.schemas import RunConfig, RunRecord, Scenario
from playground.store import (
    RUNS_DIR,
    bump_progress,
    read_progress,
    read_run,
    safe_id_component,
    write_run,
)

LOGS_DIR = Path("logs")


def scenarios_from_log(log: EvalLog, config: RunConfig) -> list[Scenario]:
    """Extrait les scénarios notés d'un log inspect.

    Un sample dont le solver ou le juge a échoué est conservé, sans scores : on
    ne jette jamais un scénario, on le montre en bas de table.
    """
    scenarios: list[Scenario] = []
    task_id = safe_id_component(log.eval.task_id)
    for sample in log.samples or []:
        raw = (sample.metadata or {}).get("scenario") or {}
        score = (sample.scores or {}).get("scenario_judge")
        meta = (score.metadata if score else None) or {}
        values = score.value if score and isinstance(score.value, dict) else {}

        scenarios.append(
            Scenario(
                scenario_id=f"{task_id}-{safe_id_component(sample.id)}",
                title=str(raw.get("title") or f"Scénario {sample.id}"),
                system_prompt=str(raw.get("system_prompt") or ""),
                opening_message=str(raw.get("opening_message") or ""),
                tests_for=str(raw.get("tests_for") or ""),
                variation_axis=(sample.metadata or {}).get("variation_axis"),
                judge_summary=str(meta.get("summary") or ""),
                judge_scores={
                    name: int(value) for name, value in values.items()
                },
                judge_justifications=meta.get("justifications") or {},
                passes=meta.get("passes") or {},
                passes_all=bool(meta.get("passes_all")),
                mean_margin=float(meta.get("mean_margin") or 0.0),
            )
        )
    return scenarios


def run_job(
    run_id: str,
    runs_dir: Path = RUNS_DIR,
    judges_dir: Path = JUDGES_DIR,
    logs_dir: Path = LOGS_DIR,
    model_args: dict[str, Any] | None = None,
) -> RunRecord:
    """Exécute un run de bout en bout et écrit le résultat.

    Args:
        run_id: Le run à exécuter, déjà créé sur disque.
        runs_dir: Où vivent les records de run.
        judges_dir: Où vivent les juges.
        logs_dir: Où inspect écrit ses `.eval`.
        model_args: Arguments passés aux modèles générateur et juge. Sert aux
            tests, avec `mockllm` — voir la docstring de
            `scenario_solver.model_args` pour la raison de ce fil explicite.

    Raises:
        Toute exception rencontrée est réenregistrée dans le record avec le
        statut `error`, puis relancée.
    """
    record = read_run(run_id, runs_dir)
    record.status = "running"
    write_run(record, runs_dir)

    try:
        dimensions = [
            load_judge(selection.name, judges_dir) for selection in record.config.judges
        ]

        task = Task(
            dataset=generation_dataset(record.config),
            solver=[
                system_message(GENERATION_SYSTEM),
                scenario_solver(record.config, model_args=model_args),
            ],
            scorer=scenario_judge(
                record.config,
                dimensions,
                on_complete=lambda: bump_progress(run_id, runs_dir),
                model_args=model_args,
            ),
            # Un scénario raté (le générateur ou le juge n'appelle pas son
            # outil) ne doit jamais interrompre les autres : par défaut,
            # inspect arrête tout le run à la première erreur de sample. Or
            # aucun scénario n'est jamais jeté ici — un sample en échec doit
            # rester dans le résultat, sans notes.
            fail_on_error=False,
        )

        log_dir = str(logs_dir / run_id)
        logs = inspect_eval(
            task,
            model=record.config.models.generator,
            model_args=model_args or {},
            log_dir=log_dir,
            display="none",
        )
        log = logs[0]

        # inspect n'exception pas sur une erreur au niveau de la tâche : il
        # l'intercepte et termine le log avec `status="error"` (ou
        # `"cancelled"` pour une annulation interne), sans rien lever. Ignorer
        # ce champ écrirait `status="done"` sur un run pourtant cassé — c'est
        # ce que consultent les propres consommateurs d'inspect
        # (`inspect_ai/_eval/eval.py`), et ce que ce module doit imiter plutôt
        # que de compter sur une exception Python qui ne viendra jamais ici.
        if log.status != "success":
            record.status = "cancelled" if log.status == "cancelled" else "error"
            record.error = (
                log.error.message
                if log.error
                else f"inspect a terminé le run avec le statut {log.status!r},"
                " sans message d'erreur."
            )
            record.progress.completed = read_progress(run_id, runs_dir)
            write_run(record, runs_dir)
            return record

        record.scenarios = scenarios_from_log(log, record.config)
        record.log_path = str(log.location) if log.location else None
        # Le nombre de scénarios produits est la valeur exacte en fin de run :
        # aucun n'est jamais jeté, y compris ceux dont le générateur a échoué.
        # Le compteur incrémenté par le scorer (`bump_progress`, lu via
        # `read_progress`) ne les compte pas, puisqu'un tel sample n'atteint
        # jamais le scorer — voir `on_complete` dans `scenario_judge`. Ce
        # compteur reste la bonne source de vérité pendant que le run tourne,
        # c'est lui qui alimente l'interface ; mais une fois le run terminé,
        # `record.scenarios` est plus exact.
        record.progress.completed = len(record.scenarios)
        record.status = "done"
        write_run(record, runs_dir)
        return record

    except Exception as error:
        record.status = "error"
        record.error = f"{type(error).__name__}: {error}"
        write_run(record, runs_dir)
        traceback.print_exc()
        raise


def main() -> None:
    """Entrypoint du sous-process."""
    if len(sys.argv) != 2:
        print("usage: python -m playground.job <run_id>", file=sys.stderr)
        raise SystemExit(2)
    run_job(sys.argv[1])


if __name__ == "__main__":
    main()
