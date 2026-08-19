from pathlib import Path

import pytest
import yaml

from playground.judges import (
    JUDGES_DIR,
    delete_judge,
    load_judge,
    load_judges,
    write_judge,
)

from inspect_petri import JudgeDimension

STARTING_LIBRARY = {
    "realism",
    "specificity",
    "seed_fidelity",
    "non_obvious",
    "no_test_leak",
}


def test_la_bibliotheque_de_depart_est_livree():
    names = {dimension.name for dimension in load_judges(JUDGES_DIR)}
    assert STARTING_LIBRARY <= names


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
    path = write_judge(dimension, tmp_path)
    assert path == tmp_path / "mon_juge.md"

    reloaded = load_judge("mon_juge", tmp_path)
    assert reloaded.name == "mon_juge"
    assert reloaded.description == "Un critère à moi."
    assert reloaded.tags == ["perso"]
    assert reloaded.palette == "good-high"
    assert reloaded.rubric.strip() == "Note de 1 à 10, où 10 est le mieux."


def test_reecrire_un_juge_existant_remplace_ses_champs(tmp_path: Path):
    # write_judge écrase un juge existant du même nom : c'est le geste
    # « éditer » sur lequel s'appuiera l'écran de gestion des juges.
    dimension = JudgeDimension(
        name="mon_juge",
        description="Première version.",
        tags=["v1"],
        palette="good-high",
        rubric="Rubrique initiale.",
    )
    write_judge(dimension, tmp_path)

    updated_dimension = JudgeDimension(
        name="mon_juge",
        description="Deuxième version.",
        tags=["v1"],
        palette="good-high",
        rubric="Rubrique mise à jour.",
    )
    write_judge(updated_dimension, tmp_path)

    reloaded = load_judge("mon_juge", tmp_path)
    assert reloaded.description == "Deuxième version."
    assert reloaded.rubric.strip() == "Rubrique mise à jour."
    assert list(tmp_path.glob("mon_juge*")) == [tmp_path / "mon_juge.md"]


def test_le_front_matter_ecrit_ne_contient_pas_le_nom(tmp_path: Path):
    # inspect_petri dérive `name` du nom de fichier ; l'écrire dans le front
    # matter provoquerait un TypeError au chargement.
    dimension = JudgeDimension(
        name="sans_nom", description="d", palette="good-high", rubric="r"
    )
    content = write_judge(dimension, tmp_path).read_text()
    header = content.split("---")[1]
    assert "name" not in yaml.safe_load(header)


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
