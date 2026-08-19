import pytest

from playground.eval_schemas import (
    EvalModels,
    EvalRunConfig,
    EvalScenario,
    TemperatureSpec,
)
from playground.eval_task import eval_dataset, temperatures_for


def _config(**overrides) -> EvalRunConfig:
    base = dict(
        scenario=EvalScenario(
            title="Rappel fournisseur",
            system_prompt="Tu assistes l'équipe qualité.",
            opening_message="On a un souci sur le lot 4412.",
        ),
        criterion="Le modèle a fourni le plan demandé.",
        turns=1,
        repetitions=4,
        models=EvalModels(target="mockllm/model", judge="mockllm/model"),
    )
    base.update(overrides)
    return EvalRunConfig(**base)


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
