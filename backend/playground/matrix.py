"""La matrice d'un run : ce qu'un modèle a obtenu sur un scénario.

Un seul endroit calcule les cases, parce que trois chemins y mènent — la fin
d'un run, une passe de juge rejouée, et la migration d'un run écrit avant que
l'échelle n'existe. Trois copies de cette agrégation dériveraient.
"""

from playground.eval_schemas import Cell, Conversation


def cells_of(
    conversations: list[Conversation], scenario_count: int
) -> list[dict[str, Cell]]:
    """La matrice, une entrée par scénario.

    La liste garde toujours `scenario_count` entrées, même vides : elle est
    alignée sur `config.scenarios`, et une ligne manquante décalerait toute la
    lecture de la matrice.

    Une répétition sans note est comptée dans `unjudged` plutôt qu'ignorée : la
    moyenne d'une case ne dit rien de ce qu'elle n'a pas pu mesurer.
    """
    cells: list[dict[str, Cell]] = [{} for _ in range(scenario_count)]
    totals: dict[tuple[int, str], float] = {}

    for conversation in conversations:
        if not 0 <= conversation.scenario_index < scenario_count:
            continue
        row = cells[conversation.scenario_index]
        cell = row.setdefault(conversation.target, Cell())
        if conversation.score is None:
            cell.unjudged += 1
            continue
        cell.judged += 1
        key = (conversation.scenario_index, conversation.target)
        totals[key] = totals.get(key, 0.0) + conversation.score

    for (scenario_index, target), total in totals.items():
        cell = cells[scenario_index][target]
        cell.mean = total / cell.judged

    return cells
