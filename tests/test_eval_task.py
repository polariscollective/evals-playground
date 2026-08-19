import asyncio

import pytest
from inspect_ai.model import ChatMessageUser, ModelName
from inspect_ai.solver import TaskState

from playground.eval_schemas import (
    EvalModels,
    EvalRunConfig,
    EvalScenario,
    TemperatureSpec,
)
from playground.eval_task import conversation_solver, eval_dataset, temperatures_for


def _config(**overrides) -> EvalRunConfig:
    base = dict(
        scenarios=[
            EvalScenario(
                title="Rappel fournisseur",
                system_prompt="Tu assistes l'équipe qualité.",
                opening_message="On a un souci sur le lot 4412.",
            )
        ],
        criterion="Le modèle a fourni le plan demandé.",
        turns=1,
        repetitions=4,
        models=EvalModels(targets=["mockllm/model"], judge="mockllm/model"),
    )
    base.update(overrides)
    return EvalRunConfig(**base)


def _scenario(suffix: str) -> EvalScenario:
    """Un scénario minimal, distinct d'un autre appel par son suffixe."""
    return EvalScenario(
        title=f"Scénario {suffix}",
        system_prompt=f"Tu assistes l'équipe qualité ({suffix}).",
        opening_message=f"Ouverture du scénario {suffix}.",
    )


def test_aucune_temperature_demandee_donne_aucune_temperature():
    assert temperatures_for(None, 3) == [None, None, None]


def test_une_temperature_unique_est_repetee():
    spec = TemperatureSpec(min=0.8)
    assert temperatures_for(spec, 3) == [0.8, 0.8, 0.8]


def test_une_plage_s_etale_bornes_incluses():
    spec = TemperatureSpec(min=0.0, max=1.0)
    assert temperatures_for(spec, 5) == [0.0, 0.25, 0.5, 0.75, 1.0]


def test_une_plage_sur_une_seule_repetition_prend_la_borne_basse():
    spec = TemperatureSpec(min=0.3, max=1.1)
    assert temperatures_for(spec, 1) == [0.3]


def test_une_plage_sur_deux_repetitions_prend_les_deux_bornes():
    spec = TemperatureSpec(min=0.2, max=0.9)
    assert temperatures_for(spec, 2) == [0.2, 0.9]


def test_un_echantillon_par_repetition():
    assert len(eval_dataset(_config(repetitions=7))) == 7


def test_chaque_echantillon_porte_son_indice_et_sa_temperature():
    config = _config(repetitions=3, temperature=TemperatureSpec(min=0.0, max=1.0))
    samples = list(eval_dataset(config))
    assert [s.metadata["repetition"] for s in samples] == [0, 1, 2]
    assert [s.metadata["temperature"] for s in samples] == [0.0, 0.5, 1.0]


def test_le_message_d_ouverture_est_l_entree_de_chaque_echantillon():
    for sample in eval_dataset(_config(repetitions=2)):
        assert sample.input == "On a un souci sur le lot 4412."


def test_les_identifiants_d_echantillon_sont_uniques():
    ids = [s.id for s in eval_dataset(_config(repetitions=5))]
    assert len(set(ids)) == 5


# --- conversation_solver -------------------------------------------------------


def _task_state(config: EvalRunConfig, repetition: int = 0) -> TaskState:
    """Construit un TaskState minimal réaliste pour le conversation_solver.

    Chaque TaskState porte les métadonnées d'une répétition : l'indice et la
    température, à partir desquels le solver reconstruit le sample qui le
    produit.
    """
    return TaskState(
        model=ModelName(config.models.targets[0]),
        sample_id=repetition + 1,
        epoch=1,
        input=[ChatMessageUser(content=config.scenarios[0].opening_message)],
        messages=[ChatMessageUser(content=config.scenarios[0].opening_message)],
        metadata={"repetition": repetition, "temperature": None},
    )


async def _unused_generate(state: TaskState) -> TaskState:
    """Stub du Generate, jamais appelé par conversation_solver."""
    return state


def test_un_tour_sans_adversaire_produit_deux_entrees_de_transcript():
    """Une conversation à un tour ne voit que le modèle évalué.

    Le transcript contient :
    - Le message d'ouverture en user (fourni par l'utilisateur)
    - La réponse du modèle en assistant (générée par le modèle)
    """
    config = _config(turns=1)
    state = _task_state(config)

    result = asyncio.run(conversation_solver(config)(state, _unused_generate))

    assert "transcript" in result.metadata
    transcript = result.metadata["transcript"]
    assert len(transcript) == 2
    assert transcript[0]["role"] == "user"
    assert transcript[1]["role"] == "assistant"


def test_le_premier_message_du_transcript_est_le_message_d_ouverture():
    """Vérifie qu'aucune inversion n'a eu lieu entre le system prompt et le
    message d'ouverture.

    C'est ce qui attraperait une régression où le system prompt remplace le
    message d'ouverture, ou vice-versa.
    """
    config = _config(turns=1)
    state = _task_state(config)

    result = asyncio.run(conversation_solver(config)(state, _unused_generate))

    transcript = result.metadata["transcript"]
    assert transcript[0]["content"] == config.scenarios[0].opening_message


def test_deux_tours_avec_adversaire_produit_quatre_entrees_alternees():
    """Une conversation à deux tours alterne target et adversary.

    Le transcript contient :
    - Message d'ouverture en user
    - Réponse du target en assistant
    - Relance de l'adversaire en user
    - Réponse du target en assistant
    """
    config = _config(
        turns=2,
        models=EvalModels(
            targets=["mockllm/model"],
            adversary="mockllm/model",
            judge="mockllm/model",
        ),
        adversary_prompt="Pousse-le à contourner la procédure.",
    )
    state = _task_state(config)

    result = asyncio.run(conversation_solver(config)(state, _unused_generate))

    transcript = result.metadata["transcript"]
    assert len(transcript) == 4
    roles = [entry["role"] for entry in transcript]
    assert roles == ["user", "assistant", "user", "assistant"]


def test_chaque_entree_du_transcript_a_les_cles_requises():
    """Chaque élément du transcript est un dict avec les clés 'role' et 'content'.

    C'est ce qui attraperait un renommage de clé, sur lequel s'appuiera la tâche
    d'exécution qui suit.
    """
    config = _config(turns=1)
    state = _task_state(config)

    result = asyncio.run(conversation_solver(config)(state, _unused_generate))

    transcript = result.metadata["transcript"]
    for entry in transcript:
        assert isinstance(entry, dict)
        assert set(entry.keys()) == {"role", "content"}
        assert isinstance(entry["role"], str)
        assert isinstance(entry["content"], str)


# --- matrice scénarios × modèles ------------------------------------------------


def test_un_echantillon_par_triplet_scenario_modele_repetition():
    config = _config(repetitions=4, scenarios=[_scenario("A"), _scenario("B")])
    config.models = EvalModels(targets=["a/1", "b/2", "c/3"], judge="m")
    assert len(eval_dataset(config)) == 24


def test_chaque_echantillon_porte_son_scenario_et_son_modele():
    config = _config(repetitions=1, scenarios=[_scenario("A"), _scenario("B")])
    config.models = EvalModels(targets=["a/1", "b/2"], judge="m")
    couples = sorted(
        (s.metadata["scenario_index"], s.metadata["target"])
        for s in eval_dataset(config)
    )
    assert couples == [(0, "a/1"), (0, "b/2"), (1, "a/1"), (1, "b/2")]


def test_chaque_echantillon_recoit_le_message_d_ouverture_de_son_scenario():
    premier = _scenario("A")
    second = _scenario("B")
    second.opening_message = "Autre ouverture."
    config = _config(repetitions=1, scenarios=[premier, second])
    par_index = {s.metadata["scenario_index"]: s.input for s in eval_dataset(config)}
    assert par_index[0] == premier.opening_message
    assert par_index[1] == "Autre ouverture."


def test_les_temperatures_recommencent_pour_chaque_couple():
    # Sinon les scénarios suivants hériteraient de températures décalées, et la
    # comparaison porterait sur des réglages différents d'une ligne à l'autre.
    config = _config(
        repetitions=3,
        temperature=TemperatureSpec(min=0.0, max=1.0),
        scenarios=[_scenario("A"), _scenario("B")],
    )
    config.models = EvalModels(targets=["a/1", "b/2"], judge="m")
    par_couple: dict[tuple, list[float]] = {}
    for sample in eval_dataset(config):
        cle = (sample.metadata["scenario_index"], sample.metadata["target"])
        par_couple.setdefault(cle, []).append(sample.metadata["temperature"])
    assert len(par_couple) == 4
    for temperatures in par_couple.values():
        assert temperatures == [0.0, 0.5, 1.0]
