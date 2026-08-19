"""Exécution d'un run d'évaluation, en sous-process.

`inspect_ai.eval()` ouvre sa propre boucle asyncio et bloque jusqu'à la fin.
Un process séparé garde l'API réactive, rend l'annulation triviale et isole un
plantage d'inspect du serveur.

Entrypoint : `python -m playground.eval_job <run_id>`.
"""

import sys
import traceback
from pathlib import Path
from typing import Any

from inspect_ai import Task, eval as inspect_eval
from inspect_ai.log import EvalLog

from playground.eval_schemas import Conversation, EvalRunRecord, Message, Tally
from playground.eval_store import (
    EVAL_RUNS_DIR,
    bump_eval_progress,
    read_eval_progress,
    read_eval_run,
    write_eval_run,
)
from playground.eval_task import conversation_solver, eval_dataset
from playground.store import safe_id_component
from playground.verdict import verdict_judge

EVAL_LOGS_DIR = Path("logs/eval")


def conversations_from_log(log: EvalLog) -> list[Conversation]:
    """Extrait les conversations jugées d'un log inspect.

    Une répétition dont le solver ou le juge a échoué est conservée, sans
    verdict : aucune donnée produite n'est jetée.
    """
    conversations: list[Conversation] = []
    task_id = safe_id_component(log.eval.task_id)
    for sample in log.samples or []:
        metadata = sample.metadata or {}
        raw_messages = metadata.get("transcript") or []
        score = (sample.scores or {}).get("verdict_judge")
        score_metadata = (score.metadata if score else None) or {}

        conversations.append(
            Conversation(
                conversation_id=f"{task_id}-{safe_id_component(sample.id)}",
                repetition=int(metadata.get("repetition", 0)),
                temperature=metadata.get("temperature"),
                messages=[
                    Message(
                        role=message.get("role", "user"),
                        content=str(message.get("content", "")),
                    )
                    for message in raw_messages
                ],
                verdict=score_metadata.get("verdict"),
                justification=str(score_metadata.get("justification") or ""),
            )
        )
    return sorted(conversations, key=lambda conversation: conversation.repetition)


def tally_of(conversations: list[Conversation]) -> Tally:
    """Décompte des verdicts. Une répétition non jugée n'entre dans aucune case."""
    tally = Tally()
    for conversation in conversations:
        if conversation.verdict == "met":
            tally.met += 1
        elif conversation.verdict == "not_met":
            tally.not_met += 1
        elif conversation.verdict == "borderline":
            tally.borderline += 1
    return tally


def run_eval_job(
    run_id: str,
    runs_dir: Path = EVAL_RUNS_DIR,
    logs_dir: Path = EVAL_LOGS_DIR,
    model_args: dict[str, Any] | None = None,
) -> EvalRunRecord:
    """Exécute un run d'évaluation de bout en bout et écrit le résultat.

    Args:
        run_id: Le run à exécuter, déjà créé sur disque.
        runs_dir: Où vivent les records de run d'évaluation.
        logs_dir: Où inspect écrit ses `.eval`.
        model_args: Arguments passés aux modèles cible, adversaire et juge.
            Sert aux tests, avec `mockllm` — voir la docstring de
            `verdict_judge.model_args` pour la raison de ce fil explicite.

    Raises:
        Toute exception rencontrée est enregistrée dans le record avec le
        statut `error`, puis relancée.
    """
    record = read_eval_run(run_id, runs_dir)
    record.status = "running"
    write_eval_run(record, runs_dir)

    try:
        task = Task(
            dataset=eval_dataset(record.config),
            solver=conversation_solver(record.config),
            scorer=verdict_judge(
                record.config,
                on_complete=lambda: bump_eval_progress(run_id, runs_dir),
                model_args=model_args,
            ),
            # Une répétition ratée ne doit pas avorter le run : les autres
            # portent l'information de fréquence, qui est le but du produit.
            fail_on_error=False,
        )

        logs = inspect_eval(
            task,
            model=record.config.models.target,
            model_args=model_args or {},
            log_dir=str(logs_dir / run_id),
            display="none",
        )
        log = logs[0]

        # Inspect n'exception pas sur une erreur de tâche : il l'intercepte et
        # termine le log avec un statut. Sans cette vérification, un run
        # cassé s'écrirait `done` sans message d'erreur.
        if log.status != "success":
            record.status = "cancelled" if log.status == "cancelled" else "error"
            record.error = (
                log.error.message
                if log.error
                else f"inspect a terminé le run avec le statut {log.status!r},"
                " sans message d'erreur."
            )
            record.progress.completed = read_eval_progress(run_id, runs_dir)
            write_eval_run(record, runs_dir)
            return record

        record.conversations = conversations_from_log(log)
        record.tally = tally_of(record.conversations)
        record.log_path = str(log.location) if log.location else None
        # Le compteur alimente la progression pendant le run ; une fois
        # terminé, le nombre réel de conversations produites est la valeur
        # exacte. Les deux régimes coexistent : remplacer l'un par l'autre
        # figerait la barre à zéro pendant toute la durée du run.
        record.progress.completed = len(record.conversations)
        record.status = "done"
        write_eval_run(record, runs_dir)
        return record

    except Exception as error:
        record.status = "error"
        record.error = f"{type(error).__name__}: {error}"
        write_eval_run(record, runs_dir)
        traceback.print_exc()
        raise


def main() -> None:
    """Entrypoint du sous-process."""
    if len(sys.argv) != 2:
        print("usage: python -m playground.eval_job <run_id>", file=sys.stderr)
        raise SystemExit(2)
    run_eval_job(sys.argv[1])


if __name__ == "__main__":
    main()
