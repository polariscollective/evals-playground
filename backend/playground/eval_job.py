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

from playground.eval_schemas import (
    Conversation,
    EvalRunRecord,
    Message,
    ModelUsage,
)
from playground.eval_store import (
    EVAL_RUNS_DIR,
    bump_eval_progress,
    read_eval_progress,
    read_eval_run,
    write_eval_run,
)
from playground.eval_task import conversation_solver, eval_dataset
from playground.matrix import cells_of
from playground.pricing import actual_cost
from playground.scoring import rubric_judge
from playground.store import safe_id_component

EVAL_LOGS_DIR = Path("logs/eval")


def conversations_from_log(log: EvalLog) -> list[Conversation]:
    """Extrait les conversations jugées d'un log inspect.

    Une répétition dont le solver ou le juge a échoué est conservée, sans
    note : aucune donnée produite n'est jetée.
    """
    conversations: list[Conversation] = []
    task_id = safe_id_component(log.eval.task_id)
    for sample in log.samples or []:
        metadata = sample.metadata or {}
        raw_messages = metadata.get("transcript") or []
        score = (sample.scores or {}).get("rubric_judge")
        score_metadata = (score.metadata if score else None) or {}

        conversations.append(
            Conversation(
                conversation_id=f"{task_id}-{safe_id_component(sample.id)}",
                repetition=int(metadata.get("repetition", 0)),
                scenario_index=int(metadata.get("scenario_index", 0)),
                target=str(metadata.get("target") or ""),
                temperature=metadata.get("temperature"),
                messages=[
                    Message(
                        role=message.get("role", "user"),
                        content=str(message.get("content", "")),
                        stop_reason=message.get("stop_reason"),
                    )
                    for message in raw_messages
                ],
                score=score_metadata.get("score"),
                justification=str(score_metadata.get("justification") or ""),
            )
        )
    return sorted(
        conversations,
        key=lambda conversation: (
            conversation.scenario_index,
            conversation.target,
            conversation.repetition,
        ),
    )


def usage_from_log(log: EvalLog) -> dict[str, ModelUsage]:
    """Les jetons réellement consommés, par modèle.

    Inspect agrège ces compteurs depuis les réponses des fournisseurs : ce sont
    les nombres facturés, pas une estimation. Les champs absents valent zéro —
    tous les fournisseurs ne rapportent pas le cache ni le raisonnement.
    """
    return {
        model: ModelUsage(
            input_tokens=counts.input_tokens or 0,
            output_tokens=counts.output_tokens or 0,
            input_tokens_cache_read=counts.input_tokens_cache_read or 0,
            input_tokens_cache_write=counts.input_tokens_cache_write or 0,
            reasoning_tokens=counts.reasoning_tokens or 0,
        )
        for model, counts in (log.stats.model_usage or {}).items()
    }


def record_usage(record: EvalRunRecord, log: EvalLog) -> None:
    """Reporte la consommation du log dans le record, et le coût qui en découle.

    Appelé aussi sur un run échoué ou annulé : les jetons déjà consommés ont
    été facturés, et ne pas les enregistrer laisserait croire le run gratuit.

    `cost_usd` reste `None` si un modèle employé n'a pas de tarif connu : un
    total amputé d'un modèle serait plus trompeur qu'une absence de total.
    """
    record.usage = usage_from_log(log)
    cost, unpriced = actual_cost(record.usage)
    record.cost_usd = None if unpriced else cost


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
            `rubric_judge.model_args` pour la raison de ce fil explicite.

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
            solver=conversation_solver(record.config, model_args=model_args),
            scorer=rubric_judge(
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
            # Le solver construit lui-même le modèle de chaque échantillon ;
            # ce modèle nominal n'est jamais sollicité, mais inspect en exige un.
            model=record.config.models.judge,
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
            record.log_path = str(log.location) if log.location else None
            record_usage(record, log)
            write_eval_run(record, runs_dir)
            return record

        record.conversations = conversations_from_log(log)
        record.cells = cells_of(
            record.conversations, len(record.config.scenarios)
        )
        record.log_path = str(log.location) if log.location else None
        record_usage(record, log)
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
