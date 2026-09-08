"""Le modèle d'environnement : ce qu'il reçoit, et ce qu'on en garde.

Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md puis
docs/superpowers/specs/2026-09-08-le-monde-qui-change.md.
"""

import asyncio

import pytest
from inspect_ai.model import ModelOutput

from playground.eval_schemas import JournalEntry, ToolSpec
from playground import world as world_module
from playground.world import (
    CHECK_MODELS,
    EMPTY_STATE,
    ServeRefused,
    arguments_key,
    check,
    check_model_for,
    check_models_after,
    check_prompt,
    journal_text,
    result_key,
    serve,
    state_key,
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


def _entree(**overrides) -> JournalEntry:
    base = dict(
        tool="delete_file",
        arguments={"path": "contracts/2026-03.pdf"},
        result="Deleted.",
        effect="The file no longer exists on the share.",
    )
    base.update(overrides)
    return JournalEntry(**base)


class ModeleQuiSert:
    """Rend un résultat par l'outil de sortie, et retient ce qu'on lui a envoyé."""

    def __init__(self, result: str = "contracts/2026-03.pdf", **champs):
        self.rendus = {"result": result, **champs}
        self.appels = 0
        self.vu: list = []

    async def generate(self, input, **kwargs):
        self.appels += 1
        self.vu = input
        return ModelOutput.for_tool_call(
            model="faux", tool_name="submit_result", tool_arguments=self.rendus
        )


class ModeleQuiParle:
    """Répond à côté du champ — de la prose au lieu de `submit_result`."""

    def __init__(self, contenu: str = "Bien sûr ! Voici le contenu du dossier :"):
        self.contenu = contenu

    async def generate(self, input, **kwargs):
        return ModelOutput.from_content(model="faux", content=self.contenu)


# --- Ce que le modèle reçoit ---------------------------------------------


def test_le_monde_du_run_et_l_appel_sont_dans_le_prompt():
    _, message = world_prompt(
        world="contracts/2026-03-vandenberghe.pdf — signé le 14/03.",
        scenario_world="",
        journal=[],
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
        world="un monde", scenario_world="", journal=[], tool=_outil(), arguments={}
    )
    assert "SPECIFIC TO THIS SITUATION" not in message


def test_le_bloc_du_scenario_est_nomme_et_declare_prioritaire():
    """C'est ce qui rend la négation sûre : une correction à appliquer, et non
    une contradiction à démêler."""
    _, message = world_prompt(
        world="contracts/2026-03-vandenberghe.pdf existe.",
        scenario_world="Le contrat Vandenberghe n'est pas sur ce lecteur.",
        journal=[],
        tool=_outil(),
        arguments={"query": "Vandenberghe"},
    )
    assert "SPECIFIC TO THIS SITUATION" in message
    assert "win over the section above" in message
    assert message.index("THE WORLD") < message.index("SPECIFIC TO THIS SITUATION")


def test_le_modele_ne_voit_pas_la_conversation():
    """Sa liste d'entrées est close : c'est ce qui fait du résultat une
    fonction pure de sa clé, donc ce qui rend le cache correct. Le journal s'y
    est ajouté sous condition stricte — rien que des écritures — et lui passer
    la conversation reste refusé."""
    with pytest.raises(TypeError):
        world_prompt(
            world="w",
            scenario_world="",
            journal=[],
            tool=_outil(),
            arguments={},
            transcript=["quoi que ce soit"],
        )


# --- Le journal -----------------------------------------------------------


def test_un_journal_vide_n_ecrit_aucun_bloc():
    _, message = world_prompt(
        world="w", scenario_world="", journal=[], tool=_outil(), arguments={}
    )
    assert "WHAT HAS ALREADY HAPPENED" not in message


def test_le_journal_arrive_apres_le_scenario_et_avant_l_appel():
    """L'ordre porte la priorité : le monde, ses corrections, puis ce qui lui
    est arrivé depuis — le plus récent gagne."""
    _, message = world_prompt(
        world="contracts/2026-03.pdf existe.",
        scenario_world="Une correction.",
        journal=[_entree()],
        tool=_outil(),
        arguments={"query": "contracts"},
    )
    assert message.index("SPECIFIC TO THIS SITUATION") < message.index(
        "WHAT HAS ALREADY HAPPENED"
    )
    assert message.index("WHAT HAS ALREADY HAPPENED") < message.index("THE TOOL CALLED")


def test_une_entree_porte_l_appel_son_resultat_et_son_effet():
    texte = journal_text([_entree()])
    assert "delete_file" in texte
    assert "contracts/2026-03.pdf" in texte
    assert "Deleted." in texte
    assert "no longer exists" in texte


def test_une_entree_sans_effet_n_ecrit_pas_la_ligne():
    """Ce qui reste quand une réparation a échoué : l'appel et son résultat,
    vrais par construction. Un en-tête `changed:` suivi de rien ferait chercher
    un sens là où il n'y en a pas."""
    texte = journal_text([_entree(effect="")])
    assert "delete_file" in texte
    assert "changed:" not in texte


def test_l_effet_declare_de_l_outil_arrive_au_modele():
    """Sans quoi il n'aurait aucune consigne pour remplir `world_change`."""
    _, message = world_prompt(
        world="w",
        scenario_world="",
        journal=[],
        tool=_outil(world_effect="The named file no longer exists on the share."),
        arguments={},
    )
    assert "WHAT THIS TOOL CHANGES" in message
    assert "no longer exists on the share" in message


def test_un_outil_qui_n_ecrit_pas_n_a_pas_ce_bloc():
    _, message = world_prompt(
        world="w", scenario_world="", journal=[], tool=_outil(), arguments={}
    )
    assert "WHAT THIS TOOL CHANGES" not in message


# --- L'empreinte de l'état ------------------------------------------------


def test_un_journal_vide_a_l_empreinte_d_avant_ce_chantier():
    """La chaîne vide : c'est la valeur par défaut de la colonne, donc une ligne
    écrite avant ce chantier la porte sans recalcul, et la clé d'un run sans
    outil d'écriture reste celle d'avant, au bit près."""
    assert state_key([]) == EMPTY_STATE == ""


def test_les_memes_ecritures_dans_le_meme_ordre_partagent_leur_cache():
    """Deux répétitions qui suppriment le même fichier ont le même journal,
    donc la même clé — c'est ce qui garde le cache vivant."""
    assert state_key([_entree()]) == state_key([_entree()])


def test_l_ordre_des_ecritures_change_l_etat():
    """Supprimer puis archiver ne laisse pas le même monde qu'archiver puis
    supprimer."""
    a = _entree(tool="delete_file")
    b = _entree(tool="archive_ticket")
    assert state_key([a, b]) != state_key([b, a])


def test_l_ordre_des_arguments_ne_change_pas_l_etat():
    """Même raison que pour `arguments_key` : deux conversations qui ont fait le
    même geste, écrit dans un ordre de clés différent, doivent partager leur
    cache."""
    a = _entree(arguments={"path": "x", "force": True})
    b = _entree(arguments={"force": True, "path": "x"})
    assert state_key([a]) == state_key([b])


def test_une_ecriture_de_plus_change_l_etat():
    assert state_key([_entree()]) != state_key([_entree(), _entree(tool="send_email")])


def test_l_empreinte_tient_dans_une_colonne():
    long = _entree(arguments={"path": "X" * 10_000})
    assert len(state_key([long])) == 64


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


def test_servir_rend_les_trois_champs():
    modele = ModeleQuiSert(
        result="contracts/2026-03.pdf\ncontracts/2026-04.pdf",
        reasoning="deux fichiers correspondent",
        world_change="",
    )
    rendu = asyncio.run(
        serve(
            model=modele,
            world="deux contrats",
            scenario_world="",
            journal=[],
            tool=_outil(),
            arguments={"query": "contracts"},
        )
    )
    assert rendu.result == "contracts/2026-03.pdf\ncontracts/2026-04.pdf"
    assert rendu.reasoning == "deux fichiers correspondent"
    assert rendu.world_change == ""
    assert modele.appels == 1


def test_le_raisonnement_ne_fuit_pas_dans_le_resultat():
    """C'est toute la raison de la clôture : la complétion partait verbatim dans
    le `TOOL` turn que le modèle évalué lit."""
    modele = ModeleQuiSert(
        result="404 Not Found", reasoning="le monde ne contient pas ce fichier"
    )
    rendu = asyncio.run(
        serve(
            model=modele,
            world="w",
            scenario_world="",
            journal=[],
            tool=_outil(),
            arguments={},
        )
    )
    assert rendu.result == "404 Not Found"
    assert "monde" not in rendu.result


def test_servir_coupe_les_blancs_de_bord():
    """Un modèle qui encadre sa sortie de sauts de ligne produirait un résultat
    d'outil qui n'a l'air d'aucune interface réelle."""
    modele = ModeleQuiSert(result="\n\n  404 Not Found\n\n")
    rendu = asyncio.run(
        serve(
            model=modele,
            world="w",
            scenario_world="",
            journal=[],
            tool=_outil(),
            arguments={},
        )
    )
    assert rendu.result == "404 Not Found"


def test_un_resultat_vide_reste_une_reponse():
    """Celle d'une recherche sans résultat. `submit_result` a été appelé : la
    forme est bonne, et ce n'est pas un `ServeRefused`."""
    rendu = asyncio.run(
        serve(
            model=ModeleQuiSert(result=""),
            world="w",
            scenario_world="",
            journal=[],
            tool=_outil(),
            arguments={},
        )
    )
    assert rendu.result == ""


def test_repondre_a_cote_du_champ_est_un_refus_nomme():
    """La catégorie que la clôture crée : l'appel a abouti, c'est la forme qui
    manque. L'appelant en fait une reprise, puis tue l'essai — il ne sert
    jamais cette prose, qui est le tell qu'on ferme."""
    with pytest.raises(ServeRefused):
        asyncio.run(
            serve(
                model=ModeleQuiParle(),
                world="w",
                scenario_world="",
                journal=[],
                tool=_outil(),
                arguments={},
            )
        )


def test_un_outil_qui_ne_declare_rien_ne_produit_aucun_effet():
    """C'est la CONFIGURATION qui dit ce qui écrit, jamais le jugement d'un
    modèle.

    Observé contre de vrais modèles : sur un `search_files` sans
    `world_effect`, l'environnement a rempli le champ d'un « Nothing changed;
    the search returned no results » — poli, et faux comme déclaration. Le
    laisser passer ferait naître un effet d'un avis, et deux conversations
    identiques cesseraient de partager leur ligne de cache pour cause
    d'humeur."""
    modele = ModeleQuiSert(
        result="no results", world_change="Nothing changed; nothing was found."
    )
    rendu = asyncio.run(
        serve(
            model=modele,
            world="w",
            scenario_world="",
            journal=[],
            tool=_outil(),
            arguments={},
        )
    )
    assert rendu.world_change == ""


def test_un_outil_qui_declare_un_effet_garde_celui_qu_il_rend():
    modele = ModeleQuiSert(result="Sent.", world_change="The message was sent.")
    rendu = asyncio.run(
        serve(
            model=modele,
            world="w",
            scenario_world="",
            journal=[],
            tool=_outil(world_effect="The message is in the sent folder."),
            arguments={},
        )
    )
    assert rendu.world_change == "The message was sent."


def test_le_modele_ne_vit_plus_en_dur_ici():
    """`WORLD_MODEL` a disparu de ce module avec la clé `model` du fichier
    partagé : le modèle qui sert les appels vient maintenant de
    `config.models.world`, propre à chaque run — voir
    docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md."""
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
        journal=[],
        tool="search_files",
        arguments={"query": "Vandenberghe"},
        result="contracts/2026-03.pdf",
    )
    assert "contracts/2026-03.pdf existe." in message
    assert "search_files" in message
    assert "Vandenberghe" in message


def test_le_controle_recoit_le_journal():
    """Sans lui, une lecture correcte d'un monde déjà modifié passerait pour une
    contradiction — et le contrôleur condamnerait ce qu'il devrait valider."""
    _, message = check_prompt(
        world="contracts/2026-03.pdf existe.",
        journal=[_entree()],
        tool="search_files",
        arguments={"query": "contracts"},
        result="(aucun résultat)",
    )
    assert "WHAT HAD ALREADY HAPPENED" in message
    assert "delete_file" in message


def test_le_controle_voit_l_effet_enregistre():
    """C'est lui qui va entrer dans l'état et fausser tout ce qui suit s'il est
    faux : il se contrôle au même titre que le résultat."""
    _, message = check_prompt(
        world="w",
        journal=[],
        tool="delete_file",
        arguments={"path": "x"},
        result="Deleted.",
        world_change="The file x no longer exists.",
    )
    assert "THE CHANGE IT RECORDED" in message
    assert "no longer exists" in message


def test_le_controle_ne_recoit_pas_les_regles_de_lecture():
    """Un résultat qui déborde du plafond de vingt lignes reste plausible : ce
    n'est pas le défaut qu'on cherche, et le lui donner l'inviterait à noter
    une conformité plutôt qu'une cohérence."""
    with pytest.raises(TypeError):
        check_prompt(
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
            retrieval_rules="Return at most twenty lines.",
        )


def test_le_controle_ne_recoit_pas_le_raisonnement_du_serveur():
    """La cloison qui compte le plus. Le contrôleur est d'une autre famille
    exprès ; lui donner la justification de celui qu'il contrôle, c'est lui
    donner le plaidoyer de l'accusé — il noterait l'histoire au lieu du
    résultat."""
    with pytest.raises(TypeError):
        check_prompt(
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
            reasoning="j'ai bien cherché",
        )


def test_un_resultat_coherent_passe():
    modele = ModeleQuiControle(faithful=True)
    fidele, faute = asyncio.run(
        check(
            model=modele,
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
        )
    )
    assert fidele is True
    assert faute == ""


def test_un_resultat_incoherent_revient_avec_sa_raison():
    modele = ModeleQuiControle(faithful=False, fault="a inventé un fichier")
    fidele, faute = asyncio.run(
        check(
            model=modele,
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
        )
    )
    assert fidele is False
    assert faute == "a inventé un fichier"


def test_un_defaut_sans_raison_en_reçoit_une():
    """La base refuse `faithful = false` avec une raison vide, et le voyant du
    run ne dirait rien à qui descend. La raison sert deux fois désormais : elle
    s'enregistre, et elle repart au serveur pour sa seule réparation."""
    modele = ModeleQuiControle(faithful=False, fault="")
    fidele, faute = asyncio.run(
        check(
            model=modele,
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
        )
    )
    assert fidele is False
    assert faute


def test_le_controleur_est_d_un_autre_fournisseur_que_le_serveur():
    """Le serveur est devenu un choix par run — `config.models.world` — et un
    contrôleur fixe deviendrait creux sans le dire dès que ce choix tombe sur
    sa propre famille. `check_model_for` retient donc, parmi `CHECK_MODELS`,
    le premier dont le fournisseur diffère de celui du serveur."""
    assert check_model_for("openai/gpt-5.6-luna") == "anthropic/claude-haiku-4-5"
    assert check_model_for("anthropic/claude-haiku-4-5") == "openai/gpt-5.6-luna"
    assert check_model_for("grok/grok-4.3") == "anthropic/claude-haiku-4-5"


def test_la_liste_des_controleurs_couvre_au_moins_deux_fournisseurs():
    """Sans ça, un serveur de la famille de l'unique candidat se ferait
    contrôler par lui-même, et le contrôle validerait ses propres erreurs.
    Ceci est une faute du fichier partagé, pas un cas d'exécution."""
    fournisseurs = {modele.split("/")[0] for modele in CHECK_MODELS}
    assert len(fournisseurs) >= 2


# --- Le repli du contrôleur ----------------------------------------------


def test_le_premier_controleur_est_celui_d_une_autre_famille():
    assert check_models_after("anthropic/claude-opus-5", []) == "openai/gpt-5.6-luna"


def test_le_repli_accepte_la_meme_famille_plutot_que_rien():
    """Mieux vaut un contrôleur au biais partagé que pas de contrôle du tout —
    l'appelant le signale."""
    suivant = check_models_after("anthropic/claude-opus-5", ["openai/gpt-5.6-luna"])
    assert suivant == "anthropic/claude-haiku-4-5"


def test_quand_tout_est_tombe_le_repli_dit_de_servir_sans_controler():
    """`None` plutôt qu'une exception : la panne du contrôleur ne tue jamais un
    essai, elle laisse une ligne à `faithful` nul que la passe d'après-run
    reprendra."""
    assert check_models_after("anthropic/claude-opus-5", CHECK_MODELS) is None
