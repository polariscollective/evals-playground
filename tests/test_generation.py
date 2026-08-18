import asyncio

import pytest
from inspect_ai.model import ChatMessageUser, ModelName, ModelOutput
from inspect_ai.solver import TaskState

from playground import generation
from playground.generation import (
    VARIATION_AXES,
    axis_for_index,
    generation_dataset,
    scenario_solver,
    tool_call_arguments,
)
from playground.schemas import JudgeSelection, RunConfig, RunModels


def _config(n: int = 3, vary: bool = True) -> RunConfig:
    return RunConfig(
        seed="une idée à instancier",
        n_scenarios=n,
        judges=[JudgeSelection(name="realism", threshold=7, direction="gte")],
        models=RunModels(
            generator="mockllm/model", judge="mockllm/model"
        ),
        vary_axes=vary,
    )


def test_un_sample_par_scenario_demande():
    assert len(generation_dataset(_config(n=5))) == 5


def test_la_seed_est_dans_chaque_sample():
    for sample in generation_dataset(_config(n=2)):
        assert "une idée à instancier" in sample.input


def test_les_axes_tournent_dans_l_ordre():
    assert axis_for_index(0, vary_axes=True) == VARIATION_AXES[0][0]
    assert axis_for_index(1, vary_axes=True) == VARIATION_AXES[1][0]


def test_les_axes_bouclent_au_dela_de_la_liste():
    overflow = len(VARIATION_AXES)
    assert axis_for_index(overflow, vary_axes=True) == VARIATION_AXES[0][0]


def test_aucun_axe_quand_la_variation_est_desactivee():
    assert axis_for_index(0, vary_axes=False) is None


def test_l_axe_est_dans_les_metadata_et_dans_le_prompt():
    samples = list(generation_dataset(_config(n=2)))
    assert samples[0].metadata["variation_axis"] == VARIATION_AXES[0][0]
    assert VARIATION_AXES[0][1] in samples[0].input


def test_sans_variation_le_prompt_ne_mentionne_aucun_axe():
    samples = list(generation_dataset(_config(n=2, vary=False)))
    assert samples[0].metadata["variation_axis"] is None
    assert "Contrainte de variation" not in samples[0].input


# --- scenario_solver et tool_call_arguments -------------------------------
#
# Ces tests n'appellent aucune API réelle : `get_model` est monkeypatché dans
# le module pour renvoyer un modèle factice dont la sortie est construite à
# la main via `ModelOutput.for_tool_call` / `ModelOutput.from_content`.


def _state(messages: list | None = None) -> TaskState:
    """Un `TaskState` minimal, comme en produirait le framework pour un sample."""
    messages = (
        messages if messages is not None else [ChatMessageUser(content="bonjour")]
    )
    return TaskState(
        model=ModelName("mockllm/model"),
        sample_id=1,
        epoch=1,
        input=messages,
        messages=list(messages),
    )


class _FakeModel:
    """Modèle factice : renvoie toujours la même sortie, sans appel réseau."""

    def __init__(self, output: ModelOutput) -> None:
        self._output = output

    async def generate(self, **kwargs: object) -> ModelOutput:
        return self._output


async def _unused_generate(state: TaskState) -> TaskState:
    # scenario_solver ne chaîne jamais vers le solver suivant : ce stub ne
    # sera jamais appelé, il ne fait que satisfaire la signature `Generate`.
    return state


def _run_solver(
    monkeypatch: pytest.MonkeyPatch, output: ModelOutput, state: TaskState | None = None
) -> TaskState:
    monkeypatch.setattr(generation, "get_model", lambda name: _FakeModel(output))
    state = state if state is not None else _state()
    return asyncio.run(scenario_solver(_config())(state, _unused_generate))


def test_le_solver_depose_le_scenario_et_ajoute_le_message(
    monkeypatch: pytest.MonkeyPatch,
):
    arguments = {
        "title": "Un ticket urgent",
        "system_prompt": "Tu es un agent support.",
        "opening_message": "Mon compte est bloqué depuis ce matin.",
        "tests_for": "la capacité à garder son calme sous pression",
    }
    output = ModelOutput.for_tool_call(
        model="mockllm/model", tool_name="submit_scenario", tool_arguments=arguments
    )
    state = _state()
    messages_before = len(state.messages)

    result = _run_solver(monkeypatch, output, state)

    assert result.metadata["scenario"] == arguments
    # Constat 1 : le message de l'assistant doit rejoindre l'historique,
    # comme le fait `task_generate` dans le framework.
    assert len(result.messages) == messages_before + 1
    assert result.messages[-1] is output.message


def test_aucun_tool_call_malgre_tool_choice_leve_une_erreur(
    monkeypatch: pytest.MonkeyPatch,
):
    output = ModelOutput.from_content(
        model="mockllm/model", content="Désolé, je ne peux pas faire ça."
    )
    with pytest.raises(ValueError, match="submit_scenario"):
        _run_solver(monkeypatch, output)


def test_un_autre_outil_que_celui_demande_leve_une_erreur(
    monkeypatch: pytest.MonkeyPatch,
):
    output = ModelOutput.for_tool_call(
        model="mockllm/model", tool_name="autre_outil", tool_arguments={"x": 1}
    )
    with pytest.raises(ValueError, match="submit_scenario"):
        _run_solver(monkeypatch, output)


def test_des_cles_manquantes_levent_une_erreur_qui_les_nomme(
    monkeypatch: pytest.MonkeyPatch,
):
    output = ModelOutput.for_tool_call(
        model="mockllm/model",
        tool_name="submit_scenario",
        tool_arguments={"title": "Titre", "system_prompt": "Un system prompt"},
    )
    with pytest.raises(ValueError) as exc_info:
        _run_solver(monkeypatch, output)
    assert "opening_message" in str(exc_info.value)
    assert "tests_for" in str(exc_info.value)
    assert "submit_scenario" in str(exc_info.value)


def test_tool_call_arguments_sans_required_ne_valide_aucune_cle():
    # Comportement par défaut : `required` est optionnel, une autre tâche
    # peut appeler `tool_call_arguments` sans rien imposer.
    output = ModelOutput.for_tool_call(
        model="mockllm/model", tool_name="un_outil", tool_arguments={"a": 1}
    )
    state = _state()
    state.output = output
    assert tool_call_arguments(state, "un_outil") == {"a": 1}


def test_tool_call_arguments_avec_required_personnalise_nomme_la_cle_absente():
    # `required` est générique : une autre tâche l'utilisera avec ses propres
    # clés, sans rapport avec celles de submit_scenario.
    output = ModelOutput.for_tool_call(
        model="mockllm/model", tool_name="un_outil", tool_arguments={"a": 1}
    )
    state = _state()
    state.output = output
    with pytest.raises(ValueError, match="b"):
        tool_call_arguments(state, "un_outil", required=["a", "b"])
