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

from playground.conversation import ToolCallRecord, Turn, run_conversation
from playground.eval_schemas import EvalRunConfig, tools_for


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
                    "turns_done": row.get("turns_done") or 0,
                    "played": row.get("messages") or [],
                },
            )
        )
    return MemoryDataset(samples, name="matrice")


def _completer_tool_call_id(joués: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Comble le `tool_call_id` des tours `tool` qui ne le portent pas.

    Cette fonction existe parce que `tool_call_id` n'est persisté que depuis
    peu : les conversations enregistrées avant n'en portent aucun sur leurs
    tours `tool`. Sans lui, `target_view` (`conversation.py`) ne peut pas
    rattacher un résultat à son appel — les fournisseurs le refusent — et le
    tour d'assistant qui le précède se ferait amputer de son appel dès le
    prochain enregistrement. Elle cessera d'être utile, et pourra être
    supprimée, une fois qu'aucune conversation en base n'aura été enregistrée
    avant l'ajout de cette persistance.

    La reconstruction n'est pas approximative : `run_conversation` produit les
    tours `tool` juste après le tour `assistant` qui a décidé leurs appels, et
    dans le même ordre (voir `conversation.py`, `tool_call_id=call.id`). Le
    n-ième tour `tool` consécutif reprend donc l'id du n-ième appel de ce tour
    assistant.
    """
    complétés: list[dict[str, Any]] = []
    appels: list[dict[str, Any]] = []
    rang = 0
    for turn in joués:
        role = turn.get("role")
        if role == "assistant":
            appels = turn.get("tool_calls") or []
            rang = 0
        elif role == "tool":
            if not turn.get("tool_call_id") and rang < len(appels):
                turn = {**turn, "tool_call_id": appels[rang].get("id")}
            rang += 1
        complétés.append(turn)
    return complétés


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
        # Une case qui porte déjà une conversation se continue : on ne lui
        # redemande que les tours manquants, et son transcript repart d'où il
        # s'était arrêté. Sans messages, elle se joue à neuf.
        joués = state.metadata.get("played") or []
        faits = int(state.metadata.get("turns_done") or 0)
        reste = max(config.turns - faits, 0) if joués else config.turns
        transcript = await run_conversation(
            system_prompt=scenario.system_prompt,
            opening_message=scenario.opening_message,
            turns=reste,
            target=get_model(target_name, **(model_args or {})),
            adversary=adversary,
            adversary_prompt=config.adversary_prompt,
            temperature=state.metadata.get("temperature"),
            history=[
                Turn(role=turn.role, content=turn.content)
                for turn in scenario.history
            ],
            resume=(
                [
                    Turn(
                        role=turn["role"],
                        content=turn["content"],
                        seeded=turn.get("seeded", False),
                        # Sans quoi le juge, appelé sur le transcript entier,
                        # perdrait la trace d'un blocage survenu avant la
                        # reprise (voir `blocking_reason` dans `scoring.py`) —
                        # et le prochain enregistrement l'effacerait pour de
                        # bon.
                        stop_reason=turn.get("stop_reason"),
                        tool_name=turn.get("tool_name"),
                        tool_call_id=turn.get("tool_call_id"),
                        tool_calls=[
                            ToolCallRecord(
                                id=call["id"],
                                name=call["name"],
                                arguments=call["arguments"],
                            )
                            for call in (turn.get("tool_calls") or [])
                        ],
                    )
                    for turn in _completer_tool_call_id(joués)
                ]
                if joués
                else None
            ),
            tools=tools_for(config, scenario),
            max_tool_calls=config.max_tool_calls_per_turn,
            stopped=stopped,
        )
        state.metadata["transcript"] = [
            {
                "role": turn.role,
                "content": turn.content,
                # Le drapeau survit jusqu'en base : sans lui, relire un run six
                # mois plus tard ne dirait plus quels tours étaient posés.
                "seeded": turn.seeded,
                # L'appel est souvent *le* comportement mesuré : il est
                # enregistré tel quel, arguments compris, et non résumé.
                "tool_calls": [
                    {"id": call.id, "name": call.name, "arguments": call.arguments}
                    for call in turn.tool_calls
                ],
                "tool_name": turn.tool_name,
                # Sur un tour `tool`, l'appel auquel ce résultat répond.
                # Persisté depuis peu : les conversations enregistrées avant
                # ne le portent pas, d'où `_completer_tool_call_id` ci-dessus.
                "tool_call_id": turn.tool_call_id,
                "stop_reason": turn.stop_reason,
            }
            for turn in transcript
        ]
        return state

    return solve
