from pathlib import Path

import pytest

from playground.judges import (
    JUDGES_DIR,
    delete_judge,
    load_judge,
    load_judges,
    write_judge,
)

from inspect_petri import JudgeDimension

BIBLIOTHEQUE_DE_DEPART = {
    "realism",
    "specificity",
    "seed_fidelity",
    "non_obvious",
    "no_test_leak",
}


def test_la_bibliotheque_de_depart_est_livree():
    noms = {dimension.name for dimension in load_judges(JUDGES_DIR)}
    assert BIBLIOTHEQUE_DE_DEPART <= noms


def test_chaque_juge_de_depart_a_une_rubrique_et_une_palette():
    for dimension in load_judges(JUDGES_DIR):
        assert dimension.description, f"{dimension.name} sans description"
        assert dimension.rubric, f"{dimension.name} sans rubrique"
        assert dimension.palette in {"good-high", "good-low", "neutral", "diverging"}


def test_repertoire_absent_donne_une_liste_vide(tmp_path: Path):
    assert load_judges(tmp_path / "inexistant") == []


def test_ecrire_puis_relire_un_juge(tmp_path: Path):
    dimension = JudgeDimension(
        name="mon_juge",
        description="Un critère à moi.",
        tags=["perso"],
        palette="good-high",
        rubric="Note de 1 à 10, où 10 est le mieux.",
    )
    chemin = write_judge(dimension, tmp_path)
    assert chemin == tmp_path / "mon_juge.md"

    relu = load_judge("mon_juge", tmp_path)
    assert relu.name == "mon_juge"
    assert relu.description == "Un critère à moi."
    assert relu.tags == ["perso"]
    assert relu.palette == "good-high"
    assert relu.rubric.strip() == "Note de 1 à 10, où 10 est le mieux."


def test_le_front_matter_ecrit_ne_contient_pas_le_nom(tmp_path: Path):
    # inspect_petri dérive `name` du nom de fichier ; l'écrire dans le front
    # matter provoquerait un TypeError au chargement.
    dimension = JudgeDimension(
        name="sans_nom", description="d", palette="good-high", rubric="r"
    )
    contenu = write_judge(dimension, tmp_path).read_text()
    entete = contenu.split("---")[1]
    assert "name:" not in entete


def test_juge_inconnu_leve_une_erreur(tmp_path: Path):
    with pytest.raises(KeyError):
        load_judge("absent", tmp_path)


def test_supprimer_un_juge(tmp_path: Path):
    dimension = JudgeDimension(
        name="jetable", description="d", palette="good-high", rubric="r"
    )
    write_judge(dimension, tmp_path)
    delete_judge("jetable", tmp_path)
    assert not (tmp_path / "jetable.md").exists()


def test_supprimer_un_juge_absent_leve_une_erreur(tmp_path: Path):
    with pytest.raises(KeyError):
        delete_judge("absent", tmp_path)


def test_front_matter_manquant_est_rejete(tmp_path: Path):
    (tmp_path / "casse.md").write_text("pas de front matter du tout")
    with pytest.raises(ValueError):
        load_judges(tmp_path)
