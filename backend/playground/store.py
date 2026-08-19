"""Stockage sur disque : un JSON par run, un YAML par scénario retenu.

Pas de base de données. Un run tient dans un fichier parce que les scénarios
sont petits (quelques kilo-octets), contrairement à des transcripts d'audit.

L'état « retenu » n'est écrit nulle part dans le record du run : la seule source
de vérité est l'existence du fichier dans `data/selected/`. Un scénario retenu
survit donc à la suppression de son run.
"""

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar

import yaml
from pydantic import BaseModel

from playground.schemas import RunConfig, RunProgress, RunRecord, Scenario

RUNS_DIR = Path("data/runs")
SELECTED_DIR = Path("data/selected")

M = TypeVar("M", bound=BaseModel)

_UNSAFE_ID_CHARS = re.compile(r"[^A-Za-z0-9_-]+")


def new_run_id() -> str:
    """Un identifiant de run court et unique."""
    return uuid.uuid4().hex[:12]


def _run_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.json"


def _progress_path(run_id: str, runs_dir: Path) -> Path:
    return runs_dir / f"{run_id}.progress"


def write_json_atomic(path: Path, payload: str) -> None:
    """Écrit un fichier JSON sans jamais laisser voir un état intermédiaire.

    Le fichier temporaire est créé dans le **même répertoire** que la
    destination : `replace` n'est atomique qu'à l'intérieur d'un même système
    de fichiers. Son suffixe `.tmp` le tient hors de la recherche `*.json` de
    `read_json_records`, sans quoi l'interface pourrait lire un JSON tronqué
    pendant qu'un sous-process écrit.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(payload, encoding="utf-8")
    temporary.replace(path)


def read_json_records(directory: Path, model: type[M]) -> list[M]:
    """Relit tous les records d'un répertoire, en ignorant les illisibles.

    `ValueError` couvre à la fois un JSON malformé et un JSON valide mais non
    conforme au schéma — un run écrit par une version antérieure du code. Un
    seul fichier abîmé ne doit pas rendre toute l'interface inutilisable.
    """
    if not directory.is_dir():
        return []
    records: list[M] = []
    for path in directory.glob("*.json"):
        try:
            records.append(model.model_validate_json(path.read_text(encoding="utf-8")))
        except ValueError:
            continue
    return records


def bump_counter(path: Path) -> None:
    """Ajoute une unité à un compteur de progression.

    Une ligne ajoutée en mode `append` plutôt qu'une réécriture : les
    répétitions se terminent en parallèle, et des ajouts courts ne s'écrasent
    pas mutuellement.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as counter:
        counter.write("1\n")


def read_counter(path: Path) -> int:
    """Valeur d'un compteur de progression. Un compteur absent vaut zéro."""
    if not path.exists():
        return 0
    return sum(1 for line in path.read_text(encoding="utf-8").splitlines() if line)


def safe_id_component(value: object) -> str:
    """Rend une valeur sûre à utiliser comme composant d'un nom de fichier.

    `scenario_id` mélange `log.eval.task_id` et `sample.id` — ce dernier
    n'étant pas garanti par inspect d'être un entier propre, ce pourrait être
    n'importe quelle chaîne fournie par un dataset. Comme `scenario_id` sert
    ensuite tel quel de nom de fichier (`data/selected/<scenario_id>.yaml`),
    tout caractère autre qu'alphanumérique, `-` ou `_` est remplacé par `_` :
    ni séparateur de chemin (`/`, `\\`), ni segment `..` ne peut donc survivre
    pour sortir de `data/selected/`. Les séquences neutralisées sont fusionnées
    pour rester lisibles, et une valeur qui deviendrait vide retombe sur `_`.

    Seule cette absence de traversée de répertoire est garantie : cette
    fonction n'est pas injective. Deux identifiants distincts peuvent se
    réduire à la même chaîne après nettoyage (par exemple `"a/b"` et `"a\\b"`
    deviennent tous deux `"a_b"`), ce qui collisionnerait alors le nom de
    fichier d'un scénario retenu avec celui d'un autre. Le cas n'est pas
    atteignable aujourd'hui : `generation_dataset` attribue à chaque sample un
    identifiant entier simple (`index + 1`), qui ne contient jamais de
    caractère neutralisé par cette fonction — la collision ne redeviendrait
    possible que si un dataset fournissait un jour des `sample.id` en chaînes
    libres, sous contrôle externe.
    """
    safe = _UNSAFE_ID_CHARS.sub("_", str(value))
    return safe or "_"


def create_run(config: RunConfig, runs_dir: Path = RUNS_DIR) -> RunRecord:
    """Crée un run en attente et l'écrit immédiatement sur disque."""
    record = RunRecord(
        run_id=new_run_id(),
        created_at=datetime.now(timezone.utc).isoformat(),
        label=config.label,
        status="pending",
        config=config,
        progress=RunProgress(completed=0, total=config.n_scenarios),
    )
    write_run(record, runs_dir)
    return record


def write_run(record: RunRecord, runs_dir: Path = RUNS_DIR) -> None:
    """Écrit un run, en remplaçant la version précédente."""
    write_json_atomic(_run_path(record.run_id, runs_dir), record.model_dump_json(indent=2))


def read_run(run_id: str, runs_dir: Path = RUNS_DIR) -> RunRecord:
    """Relit un run.

    Raises:
        KeyError: si le run n'existe pas.
    """
    path = _run_path(run_id, runs_dir)
    if not path.exists():
        raise KeyError(f"Run inconnu : {run_id!r}")
    return RunRecord.model_validate_json(path.read_text(encoding="utf-8"))


def list_runs(runs_dir: Path = RUNS_DIR) -> list[RunRecord]:
    """Tous les runs, du plus récent au plus ancien."""
    return sorted(
        read_json_records(runs_dir, RunRecord),
        key=lambda record: record.created_at,
        reverse=True,
    )


def bump_progress(run_id: str, runs_dir: Path = RUNS_DIR) -> None:
    """Signale qu'un scénario de plus est terminé."""
    bump_counter(_progress_path(run_id, runs_dir))


def read_progress(run_id: str, runs_dir: Path = RUNS_DIR) -> int:
    """Nombre de scénarios terminés d'après le fichier compteur."""
    return read_counter(_progress_path(run_id, runs_dir))


def select_scenario(
    scenario: Scenario, record: RunRecord, selected_dir: Path = SELECTED_DIR
) -> Path:
    """Fige un scénario retenu, avec sa traçabilité, dans un YAML autonome."""
    selected_dir.mkdir(parents=True, exist_ok=True)
    content = {
        "scenario_id": scenario.scenario_id,
        "title": scenario.title,
        "system_prompt": scenario.system_prompt,
        "opening_message": scenario.opening_message,
        "tests_for": scenario.tests_for,
        "seed": record.config.seed,
        "variation_axis": scenario.variation_axis,
        "judge_scores": scenario.judge_scores,
        "source": {
            "run_id": record.run_id,
            "generator": record.config.models.generator,
            "judge": record.config.models.judge,
            "created_at": record.created_at,
        },
    }
    path = selected_dir / f"{scenario.scenario_id}.yaml"
    path.write_text(
        yaml.safe_dump(content, sort_keys=False, allow_unicode=True), encoding="utf-8"
    )
    return path


def unselect_scenario(scenario_id: str, selected_dir: Path = SELECTED_DIR) -> None:
    """Relâche un scénario retenu. Sans effet s'il ne l'était pas."""
    path = selected_dir / f"{scenario_id}.yaml"
    path.unlink(missing_ok=True)


def is_selected(scenario_id: str, selected_dir: Path = SELECTED_DIR) -> bool:
    """Le scénario est-il retenu."""
    return (selected_dir / f"{scenario_id}.yaml").exists()
