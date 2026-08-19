import pytest

from playground.eval_schemas import (
    EvalModels,
    EvalRunConfig,
    EvalScenario,
    RubricLevel,
)
from playground.pricing import (
    DEFAULT_RESPONSE_TOKENS,
    OUTPUT_TOKENS_PER_CALL,
    PRICES,
    estimate_cost,
    estimate_tokens,
    response_tokens_for,
)

RUBRIC = [
    RubricLevel(value=0, meaning="R" * 40),
    RubricLevel(value=1, meaning="R" * 40),
]


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
        rubric=RUBRIC,
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


def _config_reglable(turns: int = 1) -> EvalRunConfig:
    """Un run d'un seul scénario, pour isoler l'effet d'un paramètre."""
    return EvalRunConfig(
        scenarios=[
            EvalScenario(
                title="Rappel de lot",
                system_prompt="x" * 700,
                opening_message="y" * 700,
            )
        ],
        criterion="c" * 100,
        rubric=RUBRIC,
        turns=turns,
        repetitions=5,
        models=EvalModels(
            targets=["anthropic/claude-sonnet-5"],
            adversary="anthropic/claude-haiku-4-5" if turns > 1 else None,
            judge="anthropic/claude-haiku-4-5",
        ),
        adversary_prompt="z" * 400 if turns > 1 else "",
    )


# --- la longueur de réponse, par modèle --------------------------------------


def test_chaque_modele_mesure_prend_sa_propre_longueur_de_reponse():
    # C'est tout l'objet de la calibration : une moyenne commune effacerait
    # l'écart de quarante fois entre le plus bavard et le plus laconique.
    assert response_tokens_for("openai/gpt-5.6-sol") == OUTPUT_TOKENS_PER_CALL[
        "openai/gpt-5.6-sol"
    ]
    assert response_tokens_for("grok/grok-4.3") != response_tokens_for(
        "openai/gpt-5.6-sol"
    )


def test_un_modele_jamais_mesure_prend_la_moyenne_generale():
    assert response_tokens_for("labo/modele-interne") == DEFAULT_RESPONSE_TOKENS


def test_une_longueur_imposee_ecrase_la_calibration_de_chaque_modele():
    assert response_tokens_for("openai/gpt-5.6-sol", 500) == 500
    assert response_tokens_for("grok/grok-4.3", 500) == 500


def test_un_modele_bavard_coute_plus_qu_un_modele_laconique_a_tarif_egal():
    """Le devis doit voir la différence que la moyenne commune effaçait.

    Les deux modèles comparés ici sont facturés au même tarif : tout écart de
    coût ne peut venir que de la longueur de réponse mesurée pour chacun.
    """
    bavard = estimate_cost(
        _config(
            models=EvalModels(
                targets=["anthropic/claude-sonnet-5"],
                judge="anthropic/claude-haiku-4-5",
            )
        )
    )
    laconique = estimate_cost(
        _config(
            models=EvalModels(
                targets=["anthropic/claude-haiku-4-5"],
                judge="anthropic/claude-haiku-4-5",
            )
        )
    )
    assert bavard.usd > laconique.usd


def test_le_detail_par_modele_totalise_le_prix_annonce():
    config = _config(
        models=EvalModels(
            targets=["anthropic/claude-sonnet-5", "grok/grok-4.3"],
            judge="anthropic/claude-haiku-4-5",
        )
    )
    cost = estimate_cost(config)

    assert {c.model for c in cost.per_model} == {
        "anthropic/claude-sonnet-5",
        "grok/grok-4.3",
        "anthropic/claude-haiku-4-5",
    }
    assert sum(c.usd for c in cost.per_model) == pytest.approx(cost.usd, rel=1e-3)
    # Du plus cher au moins cher : c'est le premier de la liste qui explique
    # une facture, et c'est lui qu'on veut lire en premier.
    montants = [c.usd for c in cost.per_model]
    assert montants == sorted(montants, reverse=True)


def test_un_modele_a_la_fois_evalue_et_juge_n_est_compte_qu_une_fois():
    # Le même modèle dans deux rôles est facturé une fois, sur son total.
    cost = estimate_cost(
        _config(
            models=EvalModels(
                targets=["anthropic/claude-haiku-4-5"],
                judge="anthropic/claude-haiku-4-5",
            )
        )
    )
    assert [c.model for c in cost.per_model] == ["anthropic/claude-haiku-4-5"]


def test_allonger_la_reponse_supposee_augmente_le_prix_annonce():
    """L'hypothèse est réglable parce qu'elle domine le devis : la sortie
    mesurée va de 137 jetons par appel à 5 954 selon le modèle."""
    config = _config_reglable()

    court = estimate_cost(config, 300)
    long = estimate_cost(config, 3000)

    assert court.response_tokens == 300
    assert long.response_tokens == 3000
    assert long.usd > court.usd


def test_le_prix_croit_a_peu_pres_lineairement_avec_la_longueur_supposee():
    """Doubler la longueur supposée double presque la facture.

    Presque seulement : le system prompt, le message d'ouverture et le critère
    ne dépendent pas de la longueur des réponses, et diluent le facteur.
    """
    config = _config_reglable()

    simple = estimate_cost(config, 1000).usd
    double = estimate_cost(config, 2000).usd

    assert 1.7 < double / simple < 2.0


def test_le_prix_croit_plus_vite_que_le_nombre_de_tours():
    """L'historique complet est renvoyé à chaque tour, donc l'entrée croît en
    carré du nombre de tours pendant que la sortie reste linéaire.

    Un devis qui supposerait une croissance linéaire sous-estimerait de plus
    en plus à mesure que la conversation s'allonge — exactement là où l'on
    prend le risque de lancer un gros run.
    """
    un_tour = estimate_cost(_config_reglable(turns=1), 1000).usd
    cinq_tours = estimate_cost(_config_reglable(turns=5), 1000).usd

    facteur = cinq_tours / un_tour
    assert facteur > 5, "sinon la croissance serait au plus linéaire"
    assert facteur < 25, "et elle reste sous la croissance purement quadratique"


def test_sans_hypothese_imposee_le_devis_le_dit():
    # `None` n'est pas « zéro jeton » : c'est « chaque modèle prend la sienne ».
    assert estimate_cost(_config_reglable()).response_tokens is None


def test_les_bornes_ne_bougent_pas_avec_l_hypothese():
    """Les bornes encadrent le catalogue, pas le réglage : les faire suivre
    l'hypothèse ferait croire à une garantie qui n'existe pas."""
    config = _config_reglable()

    basse = estimate_cost(config, 200)
    haute = estimate_cost(config, 8000)

    assert basse.min_usd == haute.min_usd
    assert basse.max_usd == haute.max_usd
    assert basse.min_usd <= basse.usd
