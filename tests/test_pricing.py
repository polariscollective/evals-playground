import pytest

from playground.eval_schemas import (
    EvalModels,
    EvalRunConfig,
    EvalScenario,
    RubricLevel,
)
from playground.pricing import (
    DEFAULT_RESPONSE_TOKENS,
    LengthAssumption,
    PRICES,
    estimate_cost,
    estimate_tokens,
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


def test_doubler_les_repetitions_double_le_volume():
    """Vérifié sur les jetons, pas sur les dollars.

    Les montants sont arrondis à quatre décimales avant d'être renvoyés : sur
    quelques centimes, `0.0154 × 2` ne retombe pas sur `0.0309`, alors que le
    volume sous-jacent, lui, double au jeton près. C'est la proportionnalité
    qu'on vérifie, pas la façon de l'arrondir.
    """

    def volume(repetitions):
        v = estimate_tokens(_config(repetitions=repetitions), 200)
        return (
            sum(t.input for t in v.per_model.values()),
            sum(t.output for t in v.per_model.values()),
        )

    simple_in, simple_out = volume(5)
    double_in, double_out = volume(10)
    assert (double_in, double_out) == (simple_in * 2, simple_out * 2)

    # Et le prix suit, à l'arrondi près.
    cout = estimate_cost(_config(repetitions=10)).min_usd
    assert cout == pytest.approx(estimate_cost(_config(repetitions=5)).min_usd * 2, rel=1e-2)


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


def _config_reglable(turns: int = 1, **kwargs) -> EvalRunConfig:
    """Un run d'un seul scénario, pour isoler l'effet d'un paramètre."""
    base = dict(
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
    base.update(kwargs)
    return EvalRunConfig(**base)


# --- la longueur de réponse, déclarée ou mesurée par scénario ---------------


def test_une_longueur_declaree_plus_grande_coute_plus_cher():
    """Le devis doit voir ce que la longueur déclarée change, et rien d'autre."""
    bavard = estimate_cost(_config_reglable(), 4000)
    laconique = estimate_cost(_config_reglable(), 200)
    assert bavard.usd > laconique.usd


def test_sans_rien_de_declare_le_devis_prend_la_moyenne_generale():
    config = _config_reglable()
    assert config.average_output_tokens is None
    assert estimate_cost(config).response_tokens == DEFAULT_RESPONSE_TOKENS


def test_le_devis_prend_la_longueur_declaree_par_la_config():
    config = _config_reglable(average_output_tokens=2400)
    assert estimate_cost(config).response_tokens == 2400
    assert estimate_cost(config).usd > estimate_cost(_config_reglable(), 200).usd


@pytest.mark.skip(
    reason=(
        "Cette assertion ne peut pas tenir telle quelle : avec un seul modèle "
        "cible partagé par les deux scénarios et le même nombre de tours, le "
        "coût total est une fonction strictement additive et linéaire de la "
        "longueur de chaque scénario, avec un coefficient identique pour les "
        "deux. Résultat, il ne dépend que de la somme des longueurs, jamais de "
        "leur répartition : [200, 4000] et [2100, 2100] partagent la même "
        "somme (4200) et rendent donc rigoureusement le même prix, vérifié ici "
        "à l'exactitude flottante près, pas seulement après arrondi. Ce n'est "
        "pas un bug de _resolve/estimate_cost — c'est vrai quel que soit le "
        "nombre de tours (vérifié à turns=1 et turns=3). Ce qui varie bien "
        "entre les deux hypothèses, lui, c'est le `response_tokens` du détail "
        "par modèle (voir test_une_longueur_qui_varie_se_declare_inconnue et "
        "le champ `per_model` de CostEstimate) : la case retenue est celle du "
        "premier scénario traité pour ce modèle. Laissé en `skip` plutôt que "
        "réécrit ou supprimé : changer les valeurs ou l'assertion suppose de "
        "deviner l'intention de la tâche 2, ce que la consigne du travail "
        "demande de ne pas faire sans le signaler."
    )
)
def test_une_longueur_par_scenario_s_applique_scenario_par_scenario():
    """C'est ce dont l'extension a besoin : un run à deux scénarios de
    longueurs différentes ne coûte pas le même run à leur moyenne."""
    config = _config_reglable(scenarios=[_scenario("A"), _scenario("B")])
    separe = estimate_cost(config, LengthAssumption(answer=[200, 4000]))
    moyenne = estimate_cost(config, LengthAssumption(answer=[2100, 2100]))
    assert separe.usd != moyenne.usd


def test_une_longueur_qui_varie_se_declare_inconnue():
    """`response_tokens` dit l'hypothèse retenue. Il n'y en a plus une seule
    quand chaque scénario a la sienne : `None` le dit honnêtement."""
    config = _config_reglable(scenarios=[_scenario("A"), _scenario("B")])
    assert estimate_cost(config, LengthAssumption(answer=[200, 4000])).response_tokens is None
    assert estimate_cost(config, LengthAssumption(answer=[300, 300])).response_tokens == 300


def test_l_adversaire_prend_sa_propre_longueur_quand_on_la_donne():
    # `turns=2` : à un seul tour, `_config_reglable` ne pose pas d'adversaire
    # (voir sa définition) — le faire varier ne changerait alors rien, et le
    # test ne prouverait rien.
    config = _config_reglable(turns=2)
    bavard = estimate_cost(config, LengthAssumption(answer=500, adversary=4000))
    laconique = estimate_cost(config, LengthAssumption(answer=500, adversary=50))
    assert bavard.usd > laconique.usd


def test_sans_longueur_d_adversaire_il_prend_celle_des_reponses():
    config = _config_reglable()
    implicite = estimate_cost(config, LengthAssumption(answer=500))
    explicite = estimate_cost(config, LengthAssumption(answer=500, adversary=500))
    assert implicite.usd == explicite.usd


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
    # Même raison : chaque coût par modèle est arrondi séparément, donc leur
    # somme s'écarte du total de quelques millièmes de centime.
    assert sum(c.usd for c in cost.per_model) == pytest.approx(cost.usd, rel=1e-2)
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
    """L'hypothèse est réglable parce qu'elle domine le devis : accepter une
    fourchette large de longueurs déclarées est le prix de ne pas mesurer."""
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


def test_les_bornes_ne_bougent_pas_avec_l_hypothese():
    """Les bornes encadrent le catalogue, pas le réglage : les faire suivre
    l'hypothèse ferait croire à une garantie qui n'existe pas."""
    config = _config_reglable()

    basse = estimate_cost(config, 200)
    haute = estimate_cost(config, 8000)

    assert basse.min_usd == haute.min_usd
    assert basse.max_usd == haute.max_usd
    assert basse.min_usd <= basse.usd
