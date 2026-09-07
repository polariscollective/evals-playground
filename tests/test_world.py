"""Le modèle d'environnement : ce qu'il reçoit, et ce qu'on en garde.

Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
"""

import asyncio

import pytest
from inspect_ai.model import ModelOutput

from playground.eval_schemas import ToolSpec
from playground.world import (
    WORLD_MODEL,
    arguments_key,
    result_key,
    serve,
    world_prompt,
)


def _outil(**overrides) -> ToolSpec:
    base = dict(
        name="search_files",
        description="Searches the shared drive.",
        retrieval_rules="Return at most twenty lines, most recent first.",
    )
    base.update(overrides)
    return ToolSpec(**base)


class ModeleQuiRend:
    """Rend toujours la même sortie, et retient ce qu'on lui a envoyé."""

    def __init__(self, contenu: str = "contracts/2026-03.pdf"):
        self.contenu = contenu
        self.appels = 0
        self.vu: list = []

    async def generate(self, input, **kwargs):
        self.appels += 1
        self.vu = input
        return ModelOutput.from_content(model="faux", content=self.contenu)


# --- Ce que le modèle reçoit ---------------------------------------------


def test_le_monde_du_run_et_l_appel_sont_dans_le_prompt():
    _, message = world_prompt(
        world="contracts/2026-03-vandenberghe.pdf — signé le 14/03.",
        scenario_world="",
        tool=_outil(),
        arguments={"query": "Vandenberghe"},
    )
    assert "THE WORLD" in message
    assert "contracts/2026-03-vandenberghe.pdf" in message
    assert "search_files" in message
    assert "Vandenberghe" in message
    assert "at most twenty lines" in message


def test_sans_monde_de_scenario_le_bloc_n_apparait_pas():
    """Un en-tête vide serait du bruit, et le modèle y chercherait un sens."""
    _, message = world_prompt(
        world="un monde", scenario_world="", tool=_outil(), arguments={}
    )
    assert "SPECIFIC TO THIS SITUATION" not in message


def test_le_bloc_du_scenario_est_nomme_et_declare_prioritaire():
    """C'est ce qui rend la négation sûre : une correction à appliquer, et non
    une contradiction à démêler."""
    _, message = world_prompt(
        world="contracts/2026-03-vandenberghe.pdf existe.",
        scenario_world="Le contrat Vandenberghe n'est pas sur ce lecteur.",
        tool=_outil(),
        arguments={"query": "Vandenberghe"},
    )
    assert "SPECIFIC TO THIS SITUATION" in message
    assert "win over the section above" in message
    assert message.index("THE WORLD") < message.index("SPECIFIC TO THIS SITUATION")


def test_le_modele_ne_voit_pas_la_conversation():
    """Sa liste d'entrées est close : c'est ce qui fait du résultat une
    fonction pure de sa clé, donc ce qui rend le cache correct."""
    with pytest.raises(TypeError):
        world_prompt(
            world="w",
            scenario_world="",
            tool=_outil(),
            arguments={},
            transcript=["quoi que ce soit"],
        )


# --- La clé d'un résultat -------------------------------------------------


def test_l_ordre_des_arguments_ne_change_pas_la_cle():
    """Sans quoi deux appels identiques rateraient le cache, et deux
    répétitions du même scénario verraient deux mondes."""
    assert arguments_key({"a": 1, "b": 2}) == arguments_key({"b": 2, "a": 1})


def test_des_arguments_differents_donnent_des_cles_differentes():
    assert arguments_key({"query": "X"}) != arguments_key({"query": "Y"})


def test_la_cle_tient_dans_une_colonne():
    """Un hachage, pas les arguments eux-mêmes : ils peuvent être longs, et
    c'est une clé primaire."""
    clé = result_key("search_files", {"query": "X" * 10_000})
    assert len(clé) == 64
    assert clé == result_key("search_files", {"query": "X" * 10_000})


def test_deux_outils_ne_partagent_pas_une_cle():
    assert result_key("search_files", {}) != result_key("read_file", {})


# --- Servir ---------------------------------------------------------------


def test_servir_rend_ce_que_le_modele_a_produit():
    modele = ModeleQuiRend("contracts/2026-03.pdf\ncontracts/2026-04.pdf")
    rendu = asyncio.run(
        serve(
            model=modele,
            world="deux contrats",
            scenario_world="",
            tool=_outil(),
            arguments={"query": "contracts"},
        )
    )
    assert rendu == "contracts/2026-03.pdf\ncontracts/2026-04.pdf"
    assert modele.appels == 1


def test_servir_coupe_les_blancs_de_bord():
    """Un modèle qui encadre sa sortie de sauts de ligne produirait un résultat
    d'outil qui n'a l'air d'aucune interface réelle."""
    modele = ModeleQuiRend("\n\n  404 Not Found\n\n")
    rendu = asyncio.run(
        serve(
            model=modele,
            world="w",
            scenario_world="",
            tool=_outil(),
            arguments={},
        )
    )
    assert rendu == "404 Not Found"


def test_le_modele_est_en_dur_et_partage():
    """Il vit dans `shared/`, lu par Python et par le devis — pas dans la
    configuration d'un run."""
    assert WORLD_MODEL == "openai/gpt-5.6-luna"
