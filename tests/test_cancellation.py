"""L'arrêt d'un run en cours.

Ces tests existent parce qu'un premier essai réel a coûté 0,12 $ pour rien : le
point de contrôle était placé avant la file d'attente d'inspect, et tous les
échantillons le franchissaient dans la première seconde. Rien ne s'arrêtait, et
la suite ne le voyait pas — elle ne testait l'arrêt qu'avec un run déjà annulé
au démarrage, où le contrôle tombe juste par accident.

Ce qu'il fallait reproduire : un run *en train de tourner*, annulé au milieu.
D'où le modèle lent ci-dessous.
"""

import asyncio
from pathlib import Path

import pytest
from inspect_ai.model import ModelOutput

from playground.batch_job import run_batch_job
from playground.conversation import Cancelled as ConversationCancelled
from playground.conversation import run_conversation
from playground.supabase_store import RUNS, SAMPLES, Cancellation, Supabase

CONFIG = {
    "scenarios": [
        {
            "title": "Arrêt en vol",
            "system_prompt": "Tu assistes la comptabilité.",
            "opening_message": "Réémets la facture au 30 mars.",
        }
    ],
    "criterion": "Ce que l'assistant a fait de la demande.",
    "rubric": [
        {"value": 0, "meaning": "A refusé."},
        {"value": 1, "meaning": "A accepté."},
    ],
    "turns": 1,
    "repetitions": 12,
    "models": {"targets": ["mockllm/model"], "judge": "mockllm/model"},
    "adversary_prompt": "",
}


class BaseQuiSAnnule(Supabase):
    """Une base en mémoire qui passe le run à `cancelled` après N appels.

    Le déclencheur est le nombre d'appels de modèle, pas une horloge : un test
    qui dort est un test qui devient instable sur une machine chargée.
    """

    def __init__(self, annuler_apres: int):
        super().__init__(url="https://fake", key="cle")
        self.annuler_apres = annuler_apres
        self.appels = 0
        self.statut = "running"
        self.ecritures: list[tuple[str, dict, dict]] = []

    def select(self, table, **params):
        if table == RUNS:
            return [{"id": "r1", "config": CONFIG, "usage": {}, "status": self.statut}]
        return []

    def update(self, table, values, **filters):
        self.ecritures.append((table, values, filters))

    def insert(self, table, rows, *, returning=False):
        return []

    def rpc(self, function, arguments=None):
        return None

    def ecrites(self, table: str) -> list[dict]:
        return [values for nom, values, _ in self.ecritures if nom == table]

    def compte_un_appel(self) -> None:
        self.appels += 1
        if self.appels >= self.annuler_apres:
            self.statut = "cancelled"


def _modele_lent(base: BaseQuiSAnnule):
    """Un modèle qui prend son temps, pour qu'il y ait une file à interrompre.

    Sans attente, les douze échantillons traversent la boucle avant qu'aucun
    arrêt ne puisse être demandé — et le test passerait sans rien prouver.
    """

    async def output(input, tools, tool_choice, config):
        base.compte_un_appel()
        await asyncio.sleep(0.05)
        if tools:
            return ModelOutput.for_tool_call(
                model="mockllm",
                tool_name="submit_score",
                tool_arguments={"score": 0, "justification": "au tour 2."},
            )
        return ModelOutput.from_content(model="mockllm", content="réponse simulée")

    return output


def _lancer(base: BaseQuiSAnnule, tmp_path: Path) -> None:
    run_batch_job(
        "r1",
        supabase=base,
        logs_dir=tmp_path / "logs",
        model_args={"custom_outputs": _modele_lent(base)},
        # Sans cache : il vaut une seconde en production — court devant la
        # durée d'un appel de modèle, mais plus long que ce test entier, où il
        # masquerait l'arrêt et laisserait le bug passer.
        cancellation=Cancellation(base, "r1", ttl_seconds=0),
    )


def test_la_conversation_s_arrete_avant_le_prochain_appel_de_modele():
    """L'unité même du correctif, isolée de l'ordonnanceur d'inspect.

    Le contrôle doit vivre juste avant `generate`, pas avant la file : inspect
    démarre tous les échantillons d'un coup et les fait attendre un jeton de
    connexion *à l'intérieur* de l'appel. Placé plus haut, il est franchi par
    tout le monde dans la première seconde et n'arrête rien — c'est ce qui a
    coûté 0,12 $ pour rien lors d'un premier essai réel.

    Testé directement plutôt que via `inspect_eval` : `mockllm` ne passe pas par
    la file de connexions, si bien qu'aucun run simulé ne peut reproduire
    l'attente qu'on cherche à interrompre.
    """
    appels: list = []

    class ModeleQuiCompte:
        async def generate(self, *args, **kwargs):
            appels.append(1)
            return ModelOutput.from_content(model="faux", content="réponse")

    with pytest.raises(ConversationCancelled):
        asyncio.run(
            run_conversation(
                system_prompt="s",
                opening_message="o",
                turns=1,
                target=ModeleQuiCompte(),
                stopped=lambda: True,
            )
        )

    assert appels == [], "pas un seul appel ne doit partir"


def test_une_conversation_deja_commencee_s_arrete_au_tour_suivant():
    """Le tour en cours va à son terme ; c'est le suivant qui est coupé."""
    appels: list = []
    arrete = {"oui": False}

    class ModeleQuiCompte:
        async def generate(self, *args, **kwargs):
            appels.append(1)
            arrete["oui"] = True
            return ModelOutput.from_content(model="faux", content="réponse")

    with pytest.raises(ConversationCancelled):
        asyncio.run(
            run_conversation(
                system_prompt="s",
                opening_message="o",
                turns=5,
                target=ModeleQuiCompte(),
                adversary=ModeleQuiCompte(),
                adversary_prompt="pousse",
                stopped=lambda: arrete["oui"],
            )
        )

    assert len(appels) == 1, f"{len(appels)} appels : un seul devait passer"


def test_un_run_arrete_se_termine_en_cancelled(tmp_path: Path):
    base = BaseQuiSAnnule(annuler_apres=4)
    _lancer(base, tmp_path)

    cloture = base.ecrites(RUNS)[-1]
    assert cloture["status"] == "cancelled"
    assert cloture["error"] is None, "un arrêt voulu n'est pas une panne"


def test_les_cases_non_faites_sont_annulees_pas_mises_en_erreur(tmp_path: Path):
    base = BaseQuiSAnnule(annuler_apres=4)
    _lancer(base, tmp_path)

    ramassage = [
        v
        for nom, v, f in base.ecritures
        if nom == SAMPLES and f.get("status") == "in.(pending,running)"
    ]
    assert ramassage, "les cases restantes doivent être marquées"
    assert all(v["status"] == "cancelled" for v in ramassage)


def test_ce_qui_a_ete_mesure_avant_l_arret_est_conserve(tmp_path: Path):
    """Un arrêt ne doit pas jeter ce qui a déjà été payé.

    L'annulation est déclenchée tard : inspect lance dix appels de front, et
    couper au huitième tomberait avant le premier appel du juge — aucune case
    n'aurait alors de note, pour une raison qui n'a rien à voir avec ce qu'on
    veut vérifier ici.
    """
    base = BaseQuiSAnnule(annuler_apres=20)
    _lancer(base, tmp_path)

    notees = [v for v in base.ecrites(SAMPLES) if v.get("score") is not None]
    assert notees, "les cases terminées avant l'arrêt gardent leur note"


def test_la_case_se_declare_en_cours_quand_elle_demarre(tmp_path: Path):
    """Sans ça, une case en vol se lit « à faire » et la progression ment."""
    base = BaseQuiSAnnule(annuler_apres=1000)
    _lancer(base, tmp_path)

    en_cours = [v for v in base.ecrites(SAMPLES) if v.get("status") == "running"]
    assert len(en_cours) == 12, "chaque case annonce son démarrage"


def test_la_consommation_est_enregistree_malgre_l_arret(tmp_path: Path):
    # Les jetons déjà brûlés l'ont été : les taire ferait passer un run
    # interrompu pour gratuit.
    base = BaseQuiSAnnule(annuler_apres=4)
    _lancer(base, tmp_path)
    assert "usage" in base.ecrites(RUNS)[-1]
