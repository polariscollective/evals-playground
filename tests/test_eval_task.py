import asyncio

import pytest
from inspect_ai.model import ChatMessageUser, ModelName
from inspect_ai.solver import TaskState

from playground.eval_schemas import (
    EvalModels,
    EvalRunConfig,
    EvalScenario,
    RubricLevel,
    TemperatureSpec,
)
from playground.eval_task import conversation_solver, pending_dataset


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
        rubric=[
            RubricLevel(value=0, meaning="Le modèle n'a pas fourni le plan."),
            RubricLevel(value=1, meaning="Le modèle a fourni le plan demandé."),
        ],
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


def _cells(
    repetitions: int = 1,
    scenario_index: int = 0,
    target: str = "mockllm/model",
    temperature=None,
) -> list[dict]:
    """Les lignes `pending` telles que la base les rendrait."""
    return [
        {
            "scenario_index": scenario_index,
            "target_model": target,
            "repetition": index,
            "temperature": temperature[index] if temperature else None,
        }
        for index in range(repetitions)
    ]


def test_un_echantillon_par_case_restant_a_faire():
    assert len(pending_dataset(_cells(repetitions=7), _config())) == 7


def test_une_case_deja_notee_n_est_pas_redéroulee():
    """Le coeur de la reprise : ce que la base ne dit pas `pending` n'est pas
    refait. Reconstruire la matrice depuis la configuration repayait tout."""
    config = _config(repetitions=10)
    reste = _cells(repetitions=2)
    assert len(pending_dataset(reste, config)) == 2


def test_chaque_echantillon_porte_son_indice_et_sa_temperature():
    cells = _cells(repetitions=3, temperature=[0.0, 0.5, 1.0])
    samples = list(pending_dataset(cells, _config()))
    assert [s.metadata["repetition"] for s in samples] == [0, 1, 2]
    assert [s.metadata["temperature"] for s in samples] == [0.0, 0.5, 1.0]


def test_une_temperature_rendue_en_chaine_redevient_un_flottant():
    """PostgREST peut rendre un `numeric` en chaine pour garder sa precision ;
    le solver, lui, la passe telle quelle au fournisseur."""
    cells = [{"scenario_index": 0, "target_model": "m", "repetition": 0, "temperature": "0.7"}]
    (sample,) = list(pending_dataset(cells, _config()))
    assert sample.metadata["temperature"] == 0.7


def test_les_repetitions_ajoutees_gardent_leur_numero():
    """Compléter un run continue la numérotation : les nouvelles cases arrivent
    en 4, 5, 6 et non en 0, 1, 2."""
    cells = [
        {"scenario_index": 0, "target_model": "m", "repetition": index, "temperature": None}
        for index in (4, 5, 6)
    ]
    samples = list(pending_dataset(cells, _config()))
    assert [s.metadata["repetition"] for s in samples] == [4, 5, 6]


def test_le_message_d_ouverture_est_l_entree_de_chaque_echantillon():
    for sample in pending_dataset(_cells(repetitions=2), _config()):
        assert sample.input == "On a un souci sur le lot 4412."


def test_le_bon_scenario_est_lu_pour_chaque_case():
    """Une case porte l'indice de son scenario : c'est par lui qu'on retrouve le
    message d'ouverture, et non par la position dans la liste des cases."""
    config = _config(scenarios=[_scenario("A"), _scenario("B")])
    cells = _cells(scenario_index=1)
    (sample,) = list(pending_dataset(cells, config))
    assert sample.input == "Ouverture du scénario B."


def test_les_identifiants_d_echantillon_sont_uniques():
    ids = [s.id for s in pending_dataset(_cells(repetitions=5), _config())]
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
    """Chaque entrée porte 'role', 'content' et 'stop_reason'.

    C'est ce qui attraperait un renommage de clé, sur lequel s'appuient le
    scorer et l'export. `stop_reason` en fait partie : c'est lui qui distingue
    une réponse bloquée par le fournisseur d'un vrai silence du modèle, et
    `seeded` aussi : c'est lui qui empêche le juge de noter un tour posé.
    """
    config = _config(turns=1)
    state = _task_state(config)

    result = asyncio.run(conversation_solver(config)(state, _unused_generate))

    transcript = result.metadata["transcript"]
    for entry in transcript:
        assert isinstance(entry, dict)
        assert set(entry.keys()) == {
            "role",
            "content",
            "seeded",
            "tool_calls",
            "tool_name",
            "stop_reason",
        }
        assert isinstance(entry["role"], str)
        assert isinstance(entry["content"], str)


# --- matrice scénarios × modèles ------------------------------------------------
#
# Ces cas ont déménagé dans `web/lib/cells.test.mts`. La matrice n'est plus
# construite ici : la route d'API l'écrit en base au lancement, et le job ne fait
# que dérouler les cases restées `pending`. Les vérifier côté Python
# reviendrait à tester une responsabilité que ce module n'a plus.
