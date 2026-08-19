"""Exports CSV d'un run terminé.

Deux formats, pour deux usages qui ne se recouvrent pas :

- `matrix_csv` reproduit la table telle qu'elle est affichée, pour recoller
  une matrice dans un tableur ou un rapport.
- `details_csv` déplie une ligne par conversation, avec les paramètres
  d'entrée et le transcript complet, pour ré-analyser un run hors de l'outil.

Le second est volontairement redondant : chaque ligne répète le scénario, le
prompt et la configuration. Un fichier où chaque ligne se suffit à elle-même
survit au tri, au filtre et au copier-coller partiel, ce qu'une table
normalisée ne fait pas.
"""

import csv
import io

from playground.eval_schemas import Conversation, EvalRunRecord, Tally


def failure_rate(tally: Tally) -> float | None:
    """Part des conversations où le modèle a cédé, ou None si rien n'a été jugé.

    La distinction est la même que dans la matrice : une case sans verdict
    n'est pas une case à zéro échec.
    """
    judged = tally.met + tally.not_met + tally.borderline
    return None if judged == 0 else tally.met / judged


def matrix_csv(record: EvalRunRecord) -> str:
    """La matrice telle qu'affichée : une ligne par scénario, une colonne par modèle.

    Les cases sans verdict restent vides plutôt que de valoir zéro.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    targets = record.config.models.targets
    writer.writerow(["Scenario", *targets])

    for index, scenario in enumerate(record.config.scenarios):
        row = record.tallies[index] if index < len(record.tallies) else {}
        cells = []
        for target in targets:
            rate = failure_rate(row.get(target, Tally()))
            cells.append("" if rate is None else f"{round(rate * 100)}%")
        writer.writerow([scenario.title, *cells])

    return buffer.getvalue()


def _transcript(conversation: Conversation) -> str:
    """Le multi-tours aplati en un seul champ, lisible dans une cellule."""
    return "\n\n".join(
        f"[{message.role}] {message.content}" for message in conversation.messages
    )


DETAIL_COLUMNS = [
    "run_id",
    "run_name",
    "created_at",
    "scenario_index",
    "scenario_title",
    "system_prompt",
    "opening_message",
    "target_model",
    "repetition",
    "temperature",
    "verdict",
    "justification",
    "turns",
    "message_count",
    "criterion",
    "adversary_model",
    "adversary_prompt",
    "judge_model",
    "models_configured",
    "repetitions_configured",
    "temperature_min",
    "temperature_max",
    "scenario_source",
    "source_file",
    "run_notes",
    "transcript",
]


def details_csv(record: EvalRunRecord) -> str:
    """Une ligne par conversation, avec tous les paramètres d'entrée du run.

    Chaque paramètre du formulaire figure ici : c'est ce fichier qui rend un
    run relisible sans l'application.
    """
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(DETAIL_COLUMNS)

    config = record.config
    temperature = config.temperature
    source = config.source

    for conversation in record.conversations:
        index = conversation.scenario_index
        scenario = (
            config.scenarios[index] if index < len(config.scenarios) else None
        )
        writer.writerow(
            [
                record.run_id,
                record.label or "",
                record.created_at,
                index,
                scenario.title if scenario else "",
                scenario.system_prompt if scenario else "",
                scenario.opening_message if scenario else "",
                conversation.target,
                conversation.repetition,
                "" if conversation.temperature is None else conversation.temperature,
                conversation.verdict or "",
                conversation.justification,
                config.turns,
                len(conversation.messages),
                config.criterion,
                config.models.adversary or "",
                config.adversary_prompt,
                config.models.judge,
                # La liste complète, et pas seulement le modèle de cette ligne :
                # un modèle qui n'a produit aucune conversation — provider
                # absent, run interrompu — disparaîtrait sinon de l'export,
                # et avec lui la trace qu'on avait voulu l'évaluer.
                " ".join(config.models.targets),
                config.repetitions,
                "" if temperature is None else temperature.min,
                ""
                if temperature is None or temperature.max is None
                else temperature.max,
                source.kind if source else "manual",
                source.file_name if source else "",
                record.notes,
                _transcript(conversation),
            ]
        )

    return buffer.getvalue()
