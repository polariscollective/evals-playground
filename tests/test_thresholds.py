import pytest
from inspect_petri import JudgeDimension

from playground.judges import margin, passes, suggested_threshold, verdict
from playground.schemas import JudgeSelection


def _dimension(palette: str) -> JudgeDimension:
    return JudgeDimension(name="d", description="d", palette=palette, rubric="r")


@pytest.mark.parametrize(
    "palette,expected",
    [
        ("good-high", (7, "gte")),
        ("good-low", (3, "lte")),
        ("neutral", (5, "gte")),
        ("diverging", (5, "gte")),
    ],
)
def test_seuil_suggere_depuis_la_palette(palette, expected):
    assert suggested_threshold(_dimension(palette)) == expected


def test_passes_en_direction_gte():
    assert passes(7, 7, "gte") is True
    assert passes(8, 7, "gte") is True
    assert passes(6, 7, "gte") is False


def test_passes_en_direction_lte():
    assert passes(3, 3, "lte") is True
    assert passes(2, 3, "lte") is True
    assert passes(4, 3, "lte") is False


def test_marge_positive_quand_le_juge_passe():
    assert margin(9, 7, "gte") == 2
    assert margin(1, 3, "lte") == 2


def test_marge_negative_quand_le_juge_echoue():
    assert margin(5, 7, "gte") == -2
    assert margin(5, 3, "lte") == -2


def test_marge_nulle_pile_au_seuil():
    assert margin(7, 7, "gte") == 0
    assert margin(3, 3, "lte") == 0


def test_verdict_tout_passe():
    selections = [
        JudgeSelection(name="realism", threshold=7, direction="gte"),
        JudgeSelection(name="concerning", threshold=3, direction="lte"),
    ]
    per_judge, all_pass, mean_margin = verdict({"realism": 9, "concerning": 1}, selections)
    assert per_judge == {"realism": True, "concerning": True}
    assert all_pass is True
    assert mean_margin == 2.0


def test_verdict_un_seul_echec_suffit():
    selections = [
        JudgeSelection(name="realism", threshold=7, direction="gte"),
        JudgeSelection(name="concerning", threshold=3, direction="lte"),
    ]
    per_judge, all_pass, mean_margin = verdict({"realism": 9, "concerning": 8}, selections)
    assert per_judge == {"realism": True, "concerning": False}
    assert all_pass is False
    assert mean_margin == pytest.approx(-1.5)


@pytest.mark.parametrize(
    "direction,threshold,expected_mean_margin",
    [
        ("gte", 7, -6.0),
        ("lte", 3, -7.0),
    ],
)
def test_score_manquant_compte_comme_le_pire_score_valide(
    direction, threshold, expected_mean_margin
):
    selections = [
        JudgeSelection(name="realism", threshold=threshold, direction=direction)
    ]
    per_judge, all_pass, mean_margin = verdict({}, selections)
    assert per_judge == {"realism": False}
    assert all_pass is False
    assert mean_margin == expected_mean_margin


@pytest.mark.parametrize("direction", ["gte", "lte"])
@pytest.mark.parametrize("real_score", range(1, 11))
def test_score_manquant_ne_se_classe_jamais_devant_un_score_reel(direction, real_score):
    """Invariant anti-régression : quel que soit le score réel possible (1 à 10),
    un scénario non noté ne doit jamais obtenir une marge meilleure que lui.
    """
    threshold = 5
    selections = [
        JudgeSelection(name="realism", threshold=threshold, direction=direction)
    ]
    _, _, missing_mean_margin = verdict({}, selections)
    _, _, real_mean_margin = verdict({"realism": real_score}, selections)
    assert missing_mean_margin <= real_mean_margin


def test_verdict_sans_juge_ne_passe_pas():
    per_judge, all_pass, mean_margin = verdict({"realism": 9}, [])
    assert per_judge == {}
    assert all_pass is False
    assert mean_margin == 0.0
