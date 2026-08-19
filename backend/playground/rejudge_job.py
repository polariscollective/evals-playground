"""Rejouer le juge sur un run terminé, en sous-process.

Les transcripts sont déjà là : rejuger ne rappelle ni le modèle évalué ni
l'adversaire, seulement le juge. C'est ce qui rend l'opération abordable, et
c'est pourquoi elle existe — on formule rarement la bonne question du premier
coup, et il serait absurde de repayer les conversations pour changer d'avis sur
ce qu'on y cherche.

Entrypoint : `python -m playground.rejudge_job <run_id>`.
"""

import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from inspect_ai import Task, eval as inspect_eval
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.log import EvalLog
from inspect_ai.solver import Generate, Solver, TaskState, solver

from playground.eval_job import EVAL_LOGS_DIR, usage_from_log
from playground.eval_schemas import EvalRunRecord, ModelUsage
from playground.eval_store import (
    EVAL_RUNS_DIR,
    bump_eval_progress,
    clear_rejudge_request,
    read_eval_progress,
    read_eval_run,
    read_rejudge_request,
    reset_eval_progress,
    write_eval_run,
)
from playground.matrix import cells_of
from playground.pricing import actual_cost
from playground.scoring import rubric_judge


def rejudge_dataset(record: EvalRunRecord) -> MemoryDataset:
    """Un échantillon par conversation déjà enregistrée.

    Le transcript voyage dans les métadonnées, là où le juge le cherche : c'est
    le même contrat que celui rempli par `conversation_solver` pendant un run,
    ce qui permet de réutiliser le juge sans le paramétrer différemment.

    L'identifiant de conversation suit chaque échantillon pour que les notes
    reviennent se poser sur la bonne ligne. Le rang dans la liste ne suffirait
    pas : inspect n'a aucune obligation de rendre ses échantillons dans l'ordre
    où il les a reçus.
    """
    return MemoryDataset(
        [
            Sample(
                id=index + 1,
                input=conversation.messages[0].content
                if conversation.messages
                else "",
                metadata={
                    "conversation_id": conversation.conversation_id,
                    "transcript": [
                        {
                            "role": message.role,
                            "content": message.content,
                            "stop_reason": message.stop_reason,
                        }
                        for message in conversation.messages
                    ],
                },
            )
            for index, conversation in enumerate(record.conversations)
        ],
        name="repasse",
    )


@solver
def stored_transcript() -> Solver:
    """Solver sans effet : le transcript est déjà dans les métadonnées.

    Inspect exige un solver. Celui-ci ne fait rien, volontairement — appeler
    quoi que ce soit ici rejouerait la conversation, ce qu'une passe de juge
    ne doit précisément pas faire.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        return state

    return solve


def scores_from_log(log: EvalLog) -> dict[str, tuple[float | None, str]]:
    """Les notes de la passe, par identifiant de conversation."""
    scores: dict[str, tuple[float | None, str]] = {}
    for sample in log.samples or []:
        conversation_id = (sample.metadata or {}).get("conversation_id")
        if not conversation_id:
            continue
        score = (sample.scores or {}).get("rubric_judge")
        metadata = (score.metadata if score else None) or {}
        scores[str(conversation_id)] = (
            metadata.get("score"),
            str(metadata.get("justification") or ""),
        )
    return scores


def add_usage(
    existing: dict[str, ModelUsage], added: dict[str, ModelUsage]
) -> dict[str, ModelUsage]:
    """Cumule la consommation d'une passe avec celle déjà enregistrée.

    Les jetons de la passe précédente ont été facturés : les remplacer ferait
    passer un run pour moins cher qu'il ne l'a été. Le coût d'un run est celui
    de tout ce qu'on lui a fait subir, pas de sa dernière opération.
    """
    total = {model: counts.model_copy() for model, counts in existing.items()}
    for model, counts in added.items():
        current = total.setdefault(model, ModelUsage())
        current.input_tokens += counts.input_tokens
        current.output_tokens += counts.output_tokens
        current.input_tokens_cache_read += counts.input_tokens_cache_read
        current.input_tokens_cache_write += counts.input_tokens_cache_write
        current.reasoning_tokens += counts.reasoning_tokens
    return total


def run_rejudge_job(
    run_id: str,
    runs_dir: Path = EVAL_RUNS_DIR,
    logs_dir: Path = EVAL_LOGS_DIR,
    model_args: dict[str, Any] | None = None,
) -> EvalRunRecord:
    """Rejoue le juge sur toutes les conversations d'un run.

    La nouvelle question et la nouvelle échelle n'entrent dans la configuration
    du run qu'une fois la passe réussie. Une passe qui échoue laisse donc le run
    exactement tel qu'il était, avec ses notes et la question qui les a
    produites — plutôt qu'un run décrit par une question à laquelle rien n'a
    jamais répondu.

    Args:
        run_id: Le run à rejuger. Sa demande de passe attend déjà sur disque.
        runs_dir: Où vivent les records de run d'évaluation.
        logs_dir: Où inspect écrit ses `.eval`.
        model_args: Arguments passés au modèle juge. Sert aux tests, avec
            `mockllm` — voir la docstring de `rubric_judge.model_args`.

    Raises:
        Toute exception rencontrée est enregistrée dans le record avec le
        statut `error`, puis relancée.
    """
    record = read_eval_run(run_id, runs_dir)
    request = read_rejudge_request(run_id, runs_dir)

    record.status = "running"
    record.error = None
    record.progress.completed = 0
    record.progress.total = len(record.conversations)
    reset_eval_progress(run_id, runs_dir)
    write_eval_run(record, runs_dir)

    # La configuration de la passe demandée, montée dans une copie : c'est elle
    # que le juge reçoit, sans que le record écrit sur disque en dépende encore.
    pending = record.config.model_copy(deep=True)
    pending.criterion = request.criterion
    pending.rubric = list(request.rubric)
    pending.models.judge = request.judge

    try:
        logs = inspect_eval(
            Task(
                dataset=rejudge_dataset(record),
                solver=stored_transcript(),
                scorer=rubric_judge(
                    pending,
                    on_complete=lambda: bump_eval_progress(run_id, runs_dir),
                    model_args=model_args,
                ),
                fail_on_error=False,
            ),
            model=request.judge,
            model_args=model_args or {},
            log_dir=str(logs_dir / f"{run_id}-rejudge"),
            display="none",
        )
        log = logs[0]

        if log.status != "success":
            record.status = "cancelled" if log.status == "cancelled" else "error"
            record.error = (
                log.error.message
                if log.error
                else f"inspect a terminé la passe de juge avec le statut"
                f" {log.status!r}, sans message d'erreur."
            )
            record.progress.completed = read_eval_progress(run_id, runs_dir)
            # La consommation est enregistrée même sur une passe ratée : ces
            # jetons-là ont été facturés comme les autres.
            record.usage = add_usage(record.usage, usage_from_log(log))
            cost, unpriced = actual_cost(record.usage)
            record.cost_usd = None if unpriced else cost
            write_eval_run(record, runs_dir)
            return record

        notes = scores_from_log(log)

        # `fail_on_error=False` laisse inspect terminer sur `success` même si
        # le juge a échoué sur chaque conversation : une passe stérile
        # arriverait ici avec le même statut qu'une passe réussie. Écraser des
        # notes existantes par rien n'est jamais ce qu'on voulait — alors
        # qu'une passe partiellement réussie, elle, est légitime : ses trous
        # restent visibles comme non notés dans la matrice.
        if not any(score is not None for score, _ in notes.values()) and any(
            conversation.score is not None for conversation in record.conversations
        ):
            record.status = "error"
            record.error = (
                "The judging pass produced no grade at all. The run keeps its"
                " previous grades and the question that produced them."
            )
            record.progress.completed = read_eval_progress(run_id, runs_dir)
            record.usage = add_usage(record.usage, usage_from_log(log))
            cost, unpriced = actual_cost(record.usage)
            record.cost_usd = None if unpriced else cost
            write_eval_run(record, runs_dir)
            return record

        for conversation in record.conversations:
            score, justification = notes.get(
                conversation.conversation_id, (None, "")
            )
            conversation.score = score
            conversation.justification = justification

        record.config = pending
        record.cells = cells_of(
            record.conversations, len(record.config.scenarios)
        )
        record.usage = add_usage(record.usage, usage_from_log(log))
        cost, unpriced = actual_cost(record.usage)
        record.cost_usd = None if unpriced else cost
        record.progress.completed = len(record.conversations)
        record.rejudged_at = datetime.now(timezone.utc).isoformat()
        record.status = "done"
        write_eval_run(record, runs_dir)
        return record

    except Exception as error:
        record.status = "error"
        record.error = f"{type(error).__name__}: {error}"
        write_eval_run(record, runs_dir)
        traceback.print_exc()
        raise

    finally:
        # La demande a été honorée ou a échoué ; dans les deux cas elle ne doit
        # pas rester à traîner, sous peine d'être rejouée par accident.
        clear_rejudge_request(run_id, runs_dir)


def main() -> None:
    """Entrypoint du sous-process."""
    if len(sys.argv) != 2:
        print("usage: python -m playground.rejudge_job <run_id>", file=sys.stderr)
        raise SystemExit(2)
    run_rejudge_job(sys.argv[1])


if __name__ == "__main__":
    main()
