"""Le contrat de `shared/` : ce que Python et TypeScript doivent lire pareil."""

import json

import pytest

from playground.eval_schemas import RubricLevel
from playground.pricing import PRICES
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


# --- les tarifs, en entier ---------------------------------------------------


def test_chaque_tarif_du_fichier_arrive_entier_dans_la_table():
    """Le fumigène qui prouve que Python lit vraiment `shared/pricing.json`.

    Il portait sur `estimate_cost` tant que Python savait estimer ; l'estimation
    vit désormais dans `web/lib/pricing.ts` seule (voir la docstring de
    `playground.pricing`), et la garantie s'obtient maintenant sur `PRICES`, qui
    reste. Ne pas laisser ce test partir avec ce qu'il traversait : sans lui,
    un fichier partagé mal formé ne se verrait qu'au premier run facturé.
    """
    partage = load("pricing")["prices"]
    assert set(PRICES) == set(partage)
    for nom, tarif in partage.items():
        assert PRICES[nom].input_per_mtok == tarif["input_per_mtok"], nom
        assert PRICES[nom].output_per_mtok == tarif["output_per_mtok"], nom
