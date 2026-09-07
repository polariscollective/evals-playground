"""Le modèle d'environnement : ce qu'il reçoit, et ce qu'on en garde.

Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
"""

import asyncio

import pytest
from inspect_ai.model import ModelOutput

from playground.eval_schemas import ToolSpec
from playground import world as world_module
from playground.world import (
    CHECK_MODEL,
    arguments_key,
    check,
    check_prompt,
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


def test_le_modele_ne_vit_plus_en_dur_ici():
    """`WORLD_MODEL` a disparu de ce module avec la clé `model` du fichier
    partagé : le modèle qui sert les appels vient maintenant de
    `config.models.world`, propre à chaque run — voir
    docs/superpowers/specs/2026-09-07-le-monde-des-outils.md."""
    assert not hasattr(world_module, "WORLD_MODEL")
    assert "model" not in world_module._SHARED


# --- Le contrôle ---------------------------------------------------------
#
# Une seule question : cette réponse-là pouvait-elle sortir de cet appel-là ?
# Pas « le monde est-il bien écrit » — ça se règle avant de lancer — et pas un
# audit de conformité aux règles de lecture, dont le détail n'importe pas.


class ModeleQuiControle:
    """Rend un verdict par l'outil de sortie, et retient ce qu'il a reçu."""

    def __init__(self, faithful: bool = True, fault: str = ""):
        self.verdict = {"faithful": faithful, "fault": fault}
        self.vu: list = []

    async def generate(self, input, **kwargs):
        self.vu = input
        return ModelOutput.for_tool_call(
            model="faux", tool_name="submit_check", tool_arguments=self.verdict
        )


def test_le_controle_recoit_le_monde_l_appel_et_la_reponse():
    _, message = check_prompt(
        world="contracts/2026-03.pdf existe.",
        tool="search_files",
        arguments={"query": "Vandenberghe"},
        result="contracts/2026-03.pdf",
    )
    assert "contracts/2026-03.pdf existe." in message
    assert "search_files" in message
    assert "Vandenberghe" in message


def test_le_controle_ne_recoit_pas_les_regles_de_lecture():
    """Un résultat qui déborde du plafond de vingt lignes reste plausible : ce
    n'est pas le défaut qu'on cherche, et le lui donner l'inviterait à noter
    une conformité plutôt qu'une cohérence."""
    with pytest.raises(TypeError):
        check_prompt(
            world="w",
            tool="search_files",
            arguments={},
            result="r",
            retrieval_rules="Return at most twenty lines.",
        )


def test_un_resultat_coherent_passe():
    modele = ModeleQuiControle(faithful=True)
    fidele, faute = asyncio.run(
        check(model=modele, world="w", tool="search_files", arguments={}, result="r")
    )
    assert fidele is True
    assert faute == ""


def test_un_resultat_incoherent_revient_avec_sa_raison():
    modele = ModeleQuiControle(faithful=False, fault="a inventé un fichier")
    fidele, faute = asyncio.run(
        check(model=modele, world="w", tool="search_files", arguments={}, result="r")
    )
    assert fidele is False
    assert faute == "a inventé un fichier"


def test_un_defaut_sans_raison_en_reçoit_une():
    """La base refuse `faithful = false` avec une raison vide, et le voyant du
    run ne dirait rien à qui descend."""
    modele = ModeleQuiControle(faithful=False, fault="")
    fidele, faute = asyncio.run(
        check(model=modele, world="w", tool="search_files", arguments={}, result="r")
    )
    assert fidele is False
    assert faute


def test_le_controle_reste_intact_quand_le_serveur_devient_configurable():
    """Cette tâche retire `WORLD_MODEL` et ne doit toucher à rien du côté du
    contrôle — Task 5 s'en charge, en listant `check_models` et en choisissant
    parmi eux un autre fournisseur que le serveur. En attendant, `CHECK_MODEL`
    doit rester exactement ce qu'il était."""
    assert CHECK_MODEL == "anthropic/claude-haiku-4-5"
