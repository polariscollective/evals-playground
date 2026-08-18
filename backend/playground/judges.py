"""Juges : chargement, écriture et suppression au format dimension Petri.

Un juge est un fichier `data/judges/<name>.md` : front matter YAML
(`description`, `tags`, `palette`) suivi d'un corps markdown qui sert de
rubrique. C'est exactement le format que `inspect_petri` lit, ce qui rend les
juges écrits ici chargeables tels quels par Petri.

Le champ `name` ne figure jamais dans le front matter : `inspect_petri` le
dérive du nom de fichier, et le passer en double lève un `TypeError`.
"""

from pathlib import Path

import yaml
from inspect_petri import JudgeDimension, judge_dimensions

JUDGES_DIR = Path("data/judges")


def load_judges(directory: Path = JUDGES_DIR) -> list[JudgeDimension]:
    """Tous les juges d'un répertoire, triés par nom de fichier.

    Un répertoire absent donne une liste vide : c'est un état de départ normal,
    pas une erreur.
    """
    if not directory.is_dir():
        return []
    return judge_dimensions(directory)


def load_judge(name: str, directory: Path = JUDGES_DIR) -> JudgeDimension:
    """Un juge par son nom.

    Raises:
        KeyError: si aucun juge de ce nom n'existe dans le répertoire.
    """
    for dimension in load_judges(directory):
        if dimension.name == name:
            return dimension
    raise KeyError(f"Juge inconnu : {name!r}")


def write_judge(dimension: JudgeDimension, directory: Path = JUDGES_DIR) -> Path:
    """Écrit un juge sur disque, en créant le répertoire au besoin.

    Écrase un juge existant du même nom : c'est le geste « éditer ».
    """
    directory.mkdir(parents=True, exist_ok=True)
    entete: dict[str, object] = {"description": dimension.description}
    if dimension.display_name:
        entete["display_name"] = dimension.display_name
    entete["tags"] = dimension.tags
    entete["palette"] = dimension.palette

    front_matter = yaml.safe_dump(entete, sort_keys=False, allow_unicode=True)
    corps = (dimension.rubric or "").strip()
    chemin = directory / f"{dimension.name}.md"
    chemin.write_text(f"---\n{front_matter}---\n\n{corps}\n", encoding="utf-8")
    return chemin


def delete_judge(name: str, directory: Path = JUDGES_DIR) -> None:
    """Supprime un juge.

    Raises:
        KeyError: si aucun juge de ce nom n'existe.
    """
    chemin = directory / f"{name}.md"
    if not chemin.exists():
        raise KeyError(f"Juge inconnu : {name!r}")
    chemin.unlink()
