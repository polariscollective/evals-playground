import pytest
from pydantic import ValidationError

from playground.eval_schemas import (
    Conversation,
    EvalModels,
    EvalRunConfig,
    EvalRunRecord,
    EvalRunStatus,
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


# --- Constat 1 : identifiants de modèle ne doivent pas être vides ---


def test_target_vide_est_refuse():
    """Le champ target ne doit pas accepter la chaîne vide."""
    with pytest.raises(ValidationError) as erreur:
        _config(models=EvalModels(target="", judge="mockllm/model"))
    # Le message d'erreur vient de pydantic (en anglais), on teste juste le refus
    assert "target" in str(erreur.value).lower()


def test_judge_vide_est_refuse():
    """Le champ judge ne doit pas accepter la chaîne vide."""
    with pytest.raises(ValidationError) as erreur:
        _config(models=EvalModels(target="mockllm/model", judge=""))
    assert "judge" in str(erreur.value).lower()


def test_adversary_vide_est_refuse():
    """Si adversary est fourni, il ne doit pas être une chaîne vide."""
    with pytest.raises(ValidationError) as erreur:
        _config(
            turns=3,
            adversary_prompt="Tu veux obtenir…",
            models=EvalModels(target="mockllm/model", adversary="", judge="mockllm/model"),
        )
    assert "adversary" in str(erreur.value).lower()


def test_adversary_absent_est_permis():
    """adversary est optionnel : None est accepté."""
    models = EvalModels(target="mockllm/model", judge="mockllm/model")
    assert models.adversary is None


# --- Constat 2 : bornes de turns testées complètement ---


def test_turns_borne_basse_acceptee():
    """turns=1 doit être accepté (borne basse incluse)."""
    config = _config(turns=1)
    assert config.turns == 1


def test_turns_borne_haute_acceptee():
    """turns=10 doit être accepté (borne haute incluse)."""
    config = _config(
        turns=10,
        adversary_prompt="Tu veux obtenir…",
        models=EvalModels(
            target="mockllm/model",
            adversary="mockllm/model",
            judge="mockllm/model",
        ),
    )
    assert config.turns == 10


# --- Constat 3 : EvalRunRecord couverture minimale ---


def test_evalrunrecord_se_construit_avec_les_champs_obligatoires():
    """EvalRunRecord doit accepter ses champs obligatoires."""
    record = EvalRunRecord(
        run_id="run-1",
        created_at="2024-01-01T00:00:00Z",
        label=None,
        status="pending",
        config=_config(),
    )
    assert record.run_id == "run-1"
    assert record.created_at == "2024-01-01T00:00:00Z"
    assert record.status == "pending"


def test_evalrunrecord_defaults_corrects():
    """Les valeurs par défaut doivent être conformes."""
    record = EvalRunRecord(
        run_id="run-1",
        created_at="2024-01-01T00:00:00Z",
        label=None,
        status="done",
        config=_config(),
    )
    assert record.progress.completed == 0
    assert record.progress.total == 0
    assert record.tally.met == 0
    assert record.tally.not_met == 0
    assert record.tally.borderline == 0
    assert record.conversations == []
    assert record.error is None
    assert record.log_path is None


def test_evalrunrecord_statut_inconnu_est_refuse():
    """Un statut inconnu doit être refusé."""
    with pytest.raises(ValidationError):
        EvalRunRecord(
            run_id="run-1",
            created_at="2024-01-01T00:00:00Z",
            label=None,
            status="unknown",  # Invalid status
            config=_config(),
        )
