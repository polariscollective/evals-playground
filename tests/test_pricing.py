import pytest

from playground.eval_schemas import (
    EvalModels,
    EvalRunConfig,
    EvalScenario,
)
from playground.pricing import PRICES, estimate_cost, estimate_tokens


def _scenario(title: str = "T") -> EvalScenario:
    return EvalScenario(
        title=title,
        system_prompt="S" * 400,
        opening_message="O" * 200,
    )


def _config(**overrides) -> EvalRunConfig:
    base = dict(
        scenarios=[_scenario()],
        criterion="C" * 200,
        turns=1,
        repetitions=1,
        models=EvalModels(targets=["anthropic/claude-haiku-4-5"], judge="anthropic/claude-haiku-4-5"),
    )
    base.update(overrides)
    return EvalRunConfig(**base)


def test_les_neuf_modeles_du_catalogue_ont_un_tarif():
    from playground.catalog import known_model_ids

    assert known_model_ids() <= set(PRICES)


def test_tous_les_tarifs_ont_une_entree_et_une_sortie_positives():
    for name, price in PRICES.items():
        assert price.input_per_mtok > 0, name
        assert price.output_per_mtok > 0, name


def test_le_nombre_d_appels_suit_la_formule():
    config = _config(
        scenarios=[_scenario("A"), _scenario("B")],
        turns=3,
        repetitions=4,
        adversary_prompt="Pousse-le.",
        models=EvalModels(
            targets=["anthropic/claude-haiku-4-5", "grok/grok-4.3"],
            adversary="anthropic/claude-haiku-4-5",
            judge="anthropic/claude-haiku-4-5",
        ),
    )
    estimate = estimate_tokens(config)
    # 2 scénarios x 2 modèles x 4 répétitions = 16 conversations
    assert estimate.conversations == 16
    # par conversation : 3 appels cible + 2 appels adversaire + 1 juge
    assert estimate.model_calls == 16 * 6


def test_un_one_shot_n_appelle_pas_l_adversaire():
    estimate = estimate_tokens(_config(turns=1, repetitions=5))
    assert estimate.conversations == 5
    assert estimate.model_calls == 5 * 2  # une cible, un juge


def test_la_borne_basse_est_inferieure_a_la_borne_haute():
    cost = estimate_cost(_config(
        turns=5,
        repetitions=10,
        adversary_prompt="Pousse-le.",
        models=EvalModels(
            targets=["anthropic/claude-haiku-4-5"],
            adversary="anthropic/claude-haiku-4-5",
            judge="anthropic/claude-haiku-4-5",
        ),
    ))
    assert 0 < cost.min_usd < cost.max_usd


def test_doubler_les_repetitions_double_le_cout():
    simple = estimate_cost(_config(repetitions=5))
    double = estimate_cost(_config(repetitions=10))
    assert double.min_usd == pytest.approx(simple.min_usd * 2, rel=1e-6)


def test_un_modele_cher_coute_plus_qu_un_modele_bon_marche():
    bon_marche = estimate_cost(
        _config(models=EvalModels(targets=["openai/gpt-5.6-luna"], judge="openai/gpt-5.6-luna"))
    )
    cher = estimate_cost(
        _config(models=EvalModels(targets=["openai/gpt-5.6-sol"], judge="openai/gpt-5.6-sol"))
    )
    assert cher.min_usd > bon_marche.min_usd * 5


def test_plus_de_tours_coute_plus_que_proportionnel():
    """L'historique est renvoyé à chaque tour : le coût croît plus vite que T."""
    court = estimate_cost(_config(turns=2, adversary_prompt="P",
        models=EvalModels(targets=["anthropic/claude-haiku-4-5"],
                          adversary="anthropic/claude-haiku-4-5",
                          judge="anthropic/claude-haiku-4-5")))
    long = estimate_cost(_config(turns=8, adversary_prompt="P",
        models=EvalModels(targets=["anthropic/claude-haiku-4-5"],
                          adversary="anthropic/claude-haiku-4-5",
                          judge="anthropic/claude-haiku-4-5")))
    assert long.min_usd > court.min_usd * 4


def test_un_modele_hors_catalogue_est_signale_et_non_ignore():
    config = _config(
        models=EvalModels(targets=["inconnu/modele-x"], judge="anthropic/claude-haiku-4-5")
    )
    cost = estimate_cost(config)
    assert "inconnu/modele-x" in cost.unpriced_models


def test_les_euros_suivent_les_dollars():
    cost = estimate_cost(_config())
    assert cost.min_eur < cost.min_usd
    assert cost.max_eur < cost.max_usd
