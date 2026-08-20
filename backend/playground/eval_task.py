"""Le dataset et le solver d'un run d'évaluation.

Une répétition est un échantillon inspect, et non une époque. Le mécanisme
natif `epochs=N` répète bien un échantillon, mais la configuration de
génération est par eval et non par époque : toutes les répétitions
partageraient la même température. Un échantillon par répétition permet à
chacune de porter la sienne.
"""

from typing import Any, Callable

from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.model import get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver

from playground.conversation import run_conversation
from playground.eval_schemas import EvalRunConfig


def pending_dataset(
    rows: list[dict[str, Any]], config: EvalRunConfig
) -> MemoryDataset:
    """Une case par ligne restée à faire.

    La matrice n'est pas reconstruite depuis la configuration : elle est lue en
    base, où chaque case existe déjà avec sa température. C'est ce qui permet de
    reprendre un run — relancer ses erreurs, lui ajouter des scénarios ou des
    modèles — sans refaire ce qui est déjà noté, et donc déjà payé.

    La température vient de la ligne et n'est jamais recalculée : un run complété
    en deux fois porte deux étalements, et repartir de `config.repetitions`
    réécrirait celui des cases anciennes.
    """
    samples = []
    for index, row in enumerate(rows):
        scenario_index = int(row["scenario_index"])
        scenario = config.scenarios[scenario_index]
        temperature = row.get("temperature")
        samples.append(
            Sample(
                id=index + 1,
                input=scenario.opening_message,
                metadata={
                    "scenario_index": scenario_index,
                    "target": row["target_model"],
                    "repetition": int(row["repetition"]),
                    # PostgREST peut rendre un `numeric` en chaîne pour ne pas
                    # perdre de précision ; le solver, lui, attend un flottant.
                    "temperature": None if temperature is None else float(temperature),
                },
            )
        )
    return MemoryDataset(samples, name="matrice")


@solver
def conversation_solver(
    config: EvalRunConfig,
    model_args: dict[str, Any] | None = None,
    stopped: Callable[[], bool] | None = None,
    started: Callable[[TaskState], None] | None = None,
) -> Solver:
    """Déroule une conversation complète pour une répétition.

    Args:
        config: La configuration du run, pour les modèles cible et adversaire.
        stopped: Transmis à la boucle de conversation, qui le consulte avant
            chaque appel de modèle. Le contrôler ici ne servirait à rien :
            inspect démarre tous les échantillons d'un coup, et ils franchiraient
            tous ce point avant qu'un clic n'ait pu se produire.
        started: Appelé quand la case commence réellement, une fois le premier
            jeton de connexion obtenu. Sans lui, une case en vol se lit « à
            faire » et la progression ment.
        model_args: Arguments de construction transmis à `get_model`. Voir la
            docstring de `scenario_solver.model_args` (`generation.py`) pour
            la raison de ce fil explicite : `get_model(nom)` seul ne les
            reçoit pas, puisque `mockllm` est exclu de la mémoïsation par
            inspect (les sorties personnalisées peuvent être un générateur à
            état), et qu'un nom de modèle explicite — par opposition à
            `get_model()` sans argument — ne retombe jamais sur le modèle
            actif de l'évaluation, seul à recevoir les `model_args` passés à
            `eval()`.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if started is not None:
            started(state)

        scenario = config.scenarios[int(state.metadata.get("scenario_index", 0))]
        target_name = state.metadata.get("target") or config.models.targets[0]
        adversary = (
            get_model(config.models.adversary, **(model_args or {}))
            if config.turns > 1 and config.models.adversary
            else None
        )
        transcript = await run_conversation(
            system_prompt=scenario.system_prompt,
            opening_message=scenario.opening_message,
            turns=config.turns,
            target=get_model(target_name, **(model_args or {})),
            adversary=adversary,
            adversary_prompt=config.adversary_prompt,
            temperature=state.metadata.get("temperature"),
            stopped=stopped,
        )
        state.metadata["transcript"] = [
            {
                "role": turn.role,
                "content": turn.content,
                "stop_reason": turn.stop_reason,
            }
            for turn in transcript
        ]
        return state

    return solve
