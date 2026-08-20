"""Le contrat de `shared/` : ce que Python et TypeScript doivent lire pareil."""

import json

import pytest

from playground.catalog import known_model_ids
from playground.eval_schemas import RubricLevel
from playground.pricing import PRICES, estimate_cost
from playground.scoring import JUDGE_SYSTEM, score_prompt
from playground.shared_data import SHARED_DIR, load

RUBRIC = [
    RubricLevel(value=0, meaning="Rien livré."),
    RubricLevel(value=2, meaning="Tout livré."),
]


def test_les_fichiers_partages_sont_du_json_valide():
    for nom in ("pricing", "judge-prompt"):
        assert isinstance(load(nom), dict), nom


def test_le_chemin_ne_depend_pas_du_repertoire_de_travail():
    # Le job démarre depuis /app dans son conteneur, les tests depuis la racine.
    assert SHARED_DIR.is_absolute()
    assert (SHARED_DIR / "pricing.json").exists()


def test_un_fichier_partage_manquant_echoue_franchement():
    # Mieux vaut un job qui refuse de démarrer qu'un job qui facture au mauvais
    # tarif ou qui envoie au juge un prompt qui n'est pas le bon.
    with pytest.raises(FileNotFoundError):
        load("nexiste-pas")


# --- les tarifs --------------------------------------------------------------


def test_chaque_modele_du_catalogue_a_un_tarif():
    assert known_model_ids() <= set(PRICES)


def test_les_constantes_python_viennent_bien_du_fichier():
    partage = load("pricing")
    assert PRICES["anthropic/claude-opus-5"].input_per_mtok == (
        partage["prices"]["anthropic/claude-opus-5"]["input_per_mtok"]
    )


# --- le prompt du juge -------------------------------------------------------


def test_le_gabarit_porte_ses_quatre_emplacements():
    gabarit = load("judge-prompt")["user_template"]
    for emplacement in ("{criterion}", "{transcript}", "{rubric}", "{values}"):
        assert emplacement in gabarit, emplacement


def test_le_message_systeme_vient_du_fichier():
    assert JUDGE_SYSTEM == load("judge-prompt")["system"]


def test_le_rendu_place_chaque_chose_a_sa_place():
    """Ce test est le contrat que le portage TypeScript doit reproduire.

    L'aperçu montré avant un lancement et le prompt réellement envoyé au juge
    sont rendus par deux langages différents à partir du même gabarit. S'ils
    divergeaient, l'interface décrirait un prompt qui n'existe plus, et rien ne
    le signalerait.
    """
    rendu = score_prompt("UN_TRANSCRIPT", "UNE_QUESTION", RUBRIC)

    assert "UNE_QUESTION" in rendu
    assert "UN_TRANSCRIPT" in rendu
    assert "- `0` — Rien livré." in rendu
    assert "- `2` — Tout livré." in rendu
    assert "exactly one of these values: `0`, `2`" in rendu
    # La question est délimitée, pour qu'une consigne qui s'y glisserait ne se
    # confonde pas avec les instructions du juge.
    assert rendu.index("<instructions>") < rendu.index("UNE_QUESTION")


def test_les_paliers_sont_rendus_dans_l_ordre_des_notes():
    desordre = [RUBRIC[1], RUBRIC[0]]
    rendu = score_prompt("T", "Q", desordre)
    assert rendu.index("- `0`") < rendu.index("- `2`")


# --- le devis ----------------------------------------------------------------


def test_le_devis_reste_calculable_depuis_le_fichier_partage():
    from playground.eval_schemas import EvalModels, EvalRunConfig, EvalScenario

    config = EvalRunConfig(
        scenarios=[EvalScenario(title="T", system_prompt="S" * 100,
                                opening_message="O" * 100)],
        criterion="C" * 50,
        rubric=RUBRIC,
        turns=1,
        repetitions=2,
        models=EvalModels(targets=["anthropic/claude-haiku-4-5"],
                          judge="anthropic/claude-haiku-4-5"),
    )
    devis = estimate_cost(config)
    assert devis.usd > 0
    assert devis.per_model[0].model == "anthropic/claude-haiku-4-5"
