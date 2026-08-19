"""La matrice : ce qu'une case dit, et ce qu'elle ne dit pas."""

from playground.eval_schemas import Conversation
from playground.matrix import cells_of


def _conversation(scenario: int, target: str, repetition: int, score):
    return Conversation(
        conversation_id=f"{scenario}-{target}-{repetition}",
        repetition=repetition,
        scenario_index=scenario,
        target=target,
        score=score,
    )


def test_la_case_porte_la_moyenne_des_notes():
    cells = cells_of(
        [
            _conversation(0, "m1", 0, 0.0),
            _conversation(0, "m1", 1, 2.0),
            _conversation(0, "m1", 2, 4.0),
        ],
        scenario_count=1,
    )
    assert cells[0]["m1"].mean == 2.0
    assert cells[0]["m1"].judged == 3


def test_une_repetition_sans_note_est_comptee_a_part_et_hors_moyenne():
    # C'est la distinction la plus facile à perdre : « le modèle a obtenu zéro
    # à chaque fois » et « on n'a rien pu noter » ne sont pas la même chose.
    cells = cells_of(
        [
            _conversation(0, "m1", 0, 2.0),
            _conversation(0, "m1", 1, None),
        ],
        scenario_count=1,
    )
    cellule = cells[0]["m1"]
    assert cellule.mean == 2.0, "la note manquante ne tire pas la moyenne vers zéro"
    assert (cellule.judged, cellule.unjudged) == (1, 1)


def test_une_case_dont_rien_n_a_ete_note_n_a_pas_de_moyenne():
    cells = cells_of([_conversation(0, "m1", 0, None)], scenario_count=1)
    cellule = cells[0]["m1"]
    assert cellule.mean is None
    assert (cellule.judged, cellule.unjudged) == (0, 1)


def test_la_matrice_croise_les_scenarios_et_les_modeles():
    cells = cells_of(
        [
            _conversation(0, "m1", 0, 1.0),
            _conversation(0, "m2", 0, 3.0),
            _conversation(1, "m1", 0, 0.0),
        ],
        scenario_count=2,
    )
    assert len(cells) == 2
    assert cells[0]["m1"].mean == 1.0
    assert cells[0]["m2"].mean == 3.0
    assert cells[1]["m1"].mean == 0.0
    assert "m2" not in cells[1]


def test_un_scenario_sans_conversation_garde_sa_ligne_vide():
    # La matrice doit rester alignée sur config.scenarios, même si un scénario
    # n'a produit aucune conversation exploitable : une ligne manquante
    # décalerait toute la lecture.
    assert cells_of([], scenario_count=3) == [{}, {}, {}]


def test_une_conversation_hors_des_bornes_est_ignoree():
    # Un index de scénario que la configuration ne connaît pas ne doit pas
    # faire échouer la lecture d'un run entier.
    assert cells_of([_conversation(7, "m1", 0, 1.0)], scenario_count=2) == [{}, {}]
