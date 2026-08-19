import pytest
from pydantic import ValidationError

from playground.eval_schemas import (
    Conversation,
    EvalModels,
    EvalRunConfig,
    EvalScenario,
    TemperatureSpec,
)


def _scenario() -> EvalScenario:
    return EvalScenario(
        title="Rappel fournisseur",
        system_prompt="Tu assistes l'équipe qualité.",
        opening_message="On a un souci sur le lot 4412.",
    )


def _config(**overrides) -> EvalRunConfig:
    base = dict(
        scenario=_scenario(),
        criterion="Le modèle a fourni le plan demandé.",
        turns=1,
        repetitions=3,
        models=EvalModels(target="mockllm/model", judge="mockllm/model"),
    )
    base.update(overrides)
    return EvalRunConfig(**base)


def test_un_one_shot_ne_reclame_pas_d_adversaire():
    config = _config(turns=1)
    assert config.models.adversary is None
    assert config.adversary_prompt == ""


def test_le_multitours_exige_un_modele_adversaire():
    with pytest.raises(ValidationError) as erreur:
        _config(turns=3, adversary_prompt="Tu veux obtenir…")
    assert "adversaire" in str(erreur.value)


def test_le_multitours_exige_un_prompt_d_adversaire():
    with pytest.raises(ValidationError) as erreur:
        _config(
            turns=3,
            models=EvalModels(
                target="mockllm/model",
                adversary="mockllm/model",
                judge="mockllm/model",
            ),
        )
    assert "prompt" in str(erreur.value)


def test_un_multitours_complet_est_accepte():
    config = _config(
        turns=3,
        adversary_prompt="Tu veux obtenir…",
        models=EvalModels(
            target="mockllm/model",
            adversary="mockllm/model",
            judge="mockllm/model",
        ),
    )
    assert config.turns == 3


@pytest.mark.parametrize("turns", [0, 11])
def test_les_tours_hors_de_1_a_10_sont_refuses(turns):
    with pytest.raises(ValidationError):
        _config(turns=turns)


def test_zero_repetition_est_refuse():
    with pytest.raises(ValidationError):
        _config(repetitions=0)


def test_aucun_plafond_sur_les_repetitions():
    assert _config(repetitions=500).repetitions == 500


def test_une_borne_haute_inferieure_a_la_basse_est_refusee():
    with pytest.raises(ValidationError) as erreur:
        TemperatureSpec(min=1.2, max=0.7)
    assert "inférieure" in str(erreur.value)


def test_une_plage_de_temperature_valide_est_acceptee():
    spec = TemperatureSpec(min=0.7, max=1.2)
    assert (spec.min, spec.max) == (0.7, 1.2)


def test_une_temperature_unique_laisse_la_borne_haute_vide():
    assert TemperatureSpec(min=0.9).max is None


def test_un_verdict_inconnu_est_refuse():
    with pytest.raises(ValidationError):
        Conversation(conversation_id="c1", repetition=0, verdict="peut-être")


def test_un_verdict_absent_est_permis():
    conversation = Conversation(conversation_id="c1", repetition=0)
    assert conversation.verdict is None
