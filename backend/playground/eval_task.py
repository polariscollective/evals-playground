"""Le dataset et le solver d'un run d'évaluation.

Une répétition est un échantillon inspect, et non une époque. Le mécanisme
natif `epochs=N` répète bien un échantillon, mais la configuration de
génération est par eval et non par époque : toutes les répétitions
partageraient la même température. Un échantillon par répétition permet à
chacune de porter la sienne.
"""

from typing import Any

from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.model import get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver

from playground.conversation import run_conversation
from playground.eval_schemas import EvalRunConfig, TemperatureSpec


def temperatures_for(
    spec: TemperatureSpec | None, repetitions: int
) -> list[float | None]:
    """La température de chaque répétition.

    Sans consigne, aucune température n'est envoyée et le fournisseur applique
    son défaut. Avec une borne haute, les répétitions s'étalent linéairement
    entre les deux bornes, celles-ci comprises. Une répétition unique prend la
    borne basse : il n'y a pas d'intervalle à parcourir.

    La dernière répétition renvoie `spec.max` tel quel plutôt que le calculer
    par accumulation : `spec.min + step * index` peut retomber à un cheveu de
    la borne haute par arrondi flottant (`0.2 + 0.7 == 0.8999999999999999`),
    ce que la borne demandée par l'utilisateur ne doit pas subir.
    """
    if spec is None:
        return [None] * repetitions
    if spec.max is None or repetitions == 1:
        return [spec.min] * repetitions
    step = (spec.max - spec.min) / (repetitions - 1)
    return [
        spec.max if index == repetitions - 1 else spec.min + step * index
        for index in range(repetitions)
    ]


def eval_dataset(config: EvalRunConfig) -> MemoryDataset:
    """Un échantillon par répétition, chacun portant sa température."""
    temperatures = temperatures_for(config.temperature, config.repetitions)
    samples = [
        Sample(
            id=index + 1,
            input=config.scenario.opening_message,
            metadata={"repetition": index, "temperature": temperatures[index]},
        )
        for index in range(config.repetitions)
    ]
    return MemoryDataset(samples, name="repetitions")


@solver
def conversation_solver(
    config: EvalRunConfig, model_args: dict[str, Any] | None = None
) -> Solver:
    """Déroule une conversation complète pour une répétition.

    Args:
        config: La configuration du run, pour les modèles cible et adversaire.
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
        adversary = (
            get_model(config.models.adversary, **(model_args or {}))
            if config.turns > 1 and config.models.adversary
            else None
        )
        transcript = await run_conversation(
            system_prompt=config.scenario.system_prompt,
            opening_message=config.scenario.opening_message,
            turns=config.turns,
            target=get_model(config.models.target, **(model_args or {})),
            adversary=adversary,
            adversary_prompt=config.adversary_prompt,
            temperature=state.metadata.get("temperature"),
        )
        state.metadata["transcript"] = [
            {"role": turn.role, "content": turn.content} for turn in transcript
        ]
        return state

    return solve
