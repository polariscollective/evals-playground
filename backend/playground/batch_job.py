"""Exécution d'un run d'évaluation, dans un job Cloud Run.

Entrypoint : `python -m playground.batch_job`.

Tout passe par l'environnement, jamais par la ligne de commande : Cloud Run Jobs
sait remplacer des variables d'environnement au lancement, pas des arguments.

    EVAL_RUN_ID     le run à exécuter, déjà écrit en base avec ses échantillons
    EVAL_JOB_MODE   `run` (défaut) ou `rejudge`
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY

Le job n'invente rien : la matrice existe déjà en base, une ligne par case, en
`pending`. Il ne fait que les remplir.
"""

import os
import sys
import traceback
from pathlib import Path
from typing import Any

from inspect_ai import Task, eval as inspect_eval
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.log import EvalLog
from inspect_ai.solver import Generate, Solver, TaskState, solver

from playground.eval_schemas import EvalRunConfig
from playground.eval_task import conversation_solver, eval_dataset
from playground.pricing import actual_cost
from playground.scoring import ScoredSample, rubric_judge
from playground.supabase_store import (
    SAMPLES,
    Supabase,
    abandon_unfinished_samples,
    fetch_run,
    finish_run,
    start_run,
    write_sample,
)

LOGS_DIR = Path(os.environ.get("EVAL_LOGS_DIR", "logs/eval"))


def usage_from_log(log: EvalLog) -> dict[str, dict[str, int]]:
    """Les jetons réellement consommés, par modèle.

    Inspect agrège ces compteurs depuis les réponses des fournisseurs : ce sont
    les nombres facturés, pas une estimation. Les champs absents valent zéro —
    tous les fournisseurs ne rapportent ni le cache ni le raisonnement.
    """
    return {
        model: {
            "input_tokens": counts.input_tokens or 0,
            "output_tokens": counts.output_tokens or 0,
            "input_tokens_cache_read": counts.input_tokens_cache_read or 0,
            "input_tokens_cache_write": counts.input_tokens_cache_write or 0,
            "reasoning_tokens": counts.reasoning_tokens or 0,
        }
        for model, counts in (log.stats.model_usage or {}).items()
    }


def add_usage(
    existing: dict[str, Any], added: dict[str, dict[str, int]]
) -> dict[str, dict[str, int]]:
    """Cumule la consommation d'une passe avec celle déjà enregistrée.

    Les jetons d'une passe précédente ont été facturés : les remplacer ferait
    passer un run pour moins cher qu'il ne l'a été. Le coût d'un run est celui
    de tout ce qu'on lui a fait subir, pas de sa dernière opération.
    """
    total: dict[str, dict[str, int]] = {
        model: dict(counts) for model, counts in (existing or {}).items()
    }
    for model, counts in added.items():
        current = total.setdefault(model, {})
        for champ, valeur in counts.items():
            current[champ] = current.get(champ, 0) + valeur
    return total


def rejudge_dataset(supabase: Supabase, run_id: str) -> MemoryDataset:
    """Un échantillon par conversation déjà enregistrée.

    Le transcript voyage dans les métadonnées, là où le juge le cherche : c'est
    le même contrat que remplit `conversation_solver` pendant un run, ce qui
    permet de réutiliser le juge sans le paramétrer autrement.
    """
    rows = supabase.select(
        SAMPLES,
        run_id=f"eq.{run_id}",
        select="scenario_index,target_model,repetition,temperature,messages",
        order="scenario_index,target_model,repetition",
    )
    return MemoryDataset(
        [
            Sample(
                id=index + 1,
                input=(row.get("messages") or [{}])[0].get("content", ""),
                metadata={
                    "scenario_index": row["scenario_index"],
                    "target": row["target_model"],
                    "repetition": row["repetition"],
                    "temperature": row.get("temperature"),
                    "transcript": row.get("messages") or [],
                },
            )
            for index, row in enumerate(rows)
        ],
        name="repasse",
    )


@solver
def stored_transcript() -> Solver:
    """Solver sans effet : le transcript est déjà dans les métadonnées.

    Inspect exige un solver. Celui-ci ne fait rien, volontairement — appeler
    quoi que ce soit ici rejouerait la conversation, ce qu'une passe de juge ne
    doit précisément pas faire.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        return state

    return solve


def run_batch_job(
    run_id: str,
    mode: str = "run",
    supabase: Supabase | None = None,
    logs_dir: Path = LOGS_DIR,
    model_args: dict[str, Any] | None = None,
) -> None:
    """Exécute un run, ou rejoue son juge, et écrit chaque case au fil de l'eau.

    Args:
        run_id: Le run à exécuter, déjà en base avec ses échantillons.
        mode: `run` déroule les conversations puis les juge ; `rejudge` rejoue
            le juge sur les transcripts déjà enregistrés, sans rappeler ni le
            modèle évalué ni l'adversaire.
        supabase: Injectable pour les tests, qui n'ont ainsi besoin ni de réseau
            ni de base.
        logs_dir: Où inspect écrit ses `.eval`. Éphémère dans un conteneur : ce
            qui compte est en base, pas ici.
        model_args: Arguments passés aux modèles. Sert aux tests, avec
            `mockllm` — voir la docstring de `scenario_solver.model_args`.

    Raises:
        Toute exception rencontrée est enregistrée sur le run avec le statut
        `error`, puis relancée.
    """
    supabase = supabase or Supabase.from_env()
    row = fetch_run(supabase, run_id)
    config = EvalRunConfig(**row["config"])

    start_run(supabase, run_id, execution=os.environ.get("CLOUD_RUN_EXECUTION"))

    def enregistre(sample: ScoredSample) -> None:
        write_sample(
            supabase,
            run_id,
            sample.scenario_index,
            sample.target,
            sample.repetition,
            score=sample.score,
            justification=sample.justification,
            messages=sample.messages,
            temperature=sample.temperature,
            error=sample.error,
        )

    try:
        if mode == "rejudge":
            dataset = rejudge_dataset(supabase, run_id)
            solveur: Solver = stored_transcript()
        else:
            dataset = eval_dataset(config)
            solveur = conversation_solver(config, model_args=model_args)

        logs = inspect_eval(
            Task(
                dataset=dataset,
                solver=solveur,
                scorer=rubric_judge(
                    config, on_scored=enregistre, model_args=model_args
                ),
                # Une répétition ratée ne doit pas avorter le run : les autres
                # portent l'information de fréquence, qui est le but du produit.
                fail_on_error=False,
            ),
            # Le solver construit lui-même le modèle de chaque échantillon ; ce
            # modèle nominal n'est jamais sollicité, mais inspect en exige un.
            model=config.models.judge,
            model_args=model_args or {},
            log_dir=str(logs_dir / run_id),
            display="none",
        )
        log = logs[0]

        # Un échantillon dont le solver a échoué n'atteint jamais le scorer,
        # donc jamais `enregistre`. Sans ce ramassage il resterait « à faire »
        # sur un run pourtant terminé.
        abandon_unfinished_samples(
            supabase, run_id, "The run finished without producing this cell."
        )

        usage = add_usage(row.get("usage") or {}, usage_from_log(log))
        cost, unpriced = actual_cost_from_dicts(usage)

        # Inspect n'exception pas sur une erreur de tâche : il l'intercepte et
        # termine le journal avec un statut. Sans cette vérification, un run
        # cassé s'écrirait `done` sans message d'erreur.
        erreur = None
        if log.status != "success":
            erreur = (
                log.error.message
                if log.error
                else f"inspect finished with status {log.status!r} and no message."
            )

        finish_run(
            supabase,
            run_id,
            usage=usage,
            # Un total amputé d'un modèle sans tarif connu serait plus trompeur
            # qu'une absence de total.
            cost_usd=None if unpriced else cost,
            error=erreur,
        )

    except Exception as error:
        abandon_unfinished_samples(
            supabase, run_id, f"{type(error).__name__}: {error}"
        )
        finish_run(supabase, run_id, error=f"{type(error).__name__}: {error}")
        traceback.print_exc()
        raise


def actual_cost_from_dicts(usage: dict[str, Any]) -> tuple[float, list[str]]:
    """Coût réel depuis la consommation telle qu'elle vit en base, en JSON."""
    from playground.eval_schemas import ModelUsage

    return actual_cost(
        {model: ModelUsage(**counts) for model, counts in usage.items()}
    )


def main() -> None:
    """Entrypoint du job."""
    run_id = os.environ.get("EVAL_RUN_ID")
    if not run_id:
        print("EVAL_RUN_ID is required.", file=sys.stderr)
        raise SystemExit(2)
    run_batch_job(run_id, mode=os.environ.get("EVAL_JOB_MODE", "run"))


if __name__ == "__main__":
    main()
