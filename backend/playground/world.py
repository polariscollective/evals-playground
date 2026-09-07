"""Le monde : ce qui existe, et le modèle qui sert les appels depuis ce texte.

Un outil est fixe ou servi. Fixe, il rend `ToolSpec.result` et rien ne se
passe ici. Servi — il porte des `retrieval_rules` — c'est ce module qui produit
sa réponse, en donnant à un petit modèle le monde du run, celui du scénario,
les règles de lecture de l'outil, son nom et ses arguments.

**Et rien d'autre.** Pas la conversation, pas le critère, pas les notes, pas ce
que les autres outils ont déjà rendu. Cette liste close n'est pas de
l'économie : c'est elle qui fait du résultat une fonction pure de sa clé, et
donc ce qui rend le cache correct plutôt qu'approximatif. Tout ce qu'on y
ajouterait ferait du résultat une chose qui dépend du passé, et il n'y aurait
plus rien à mettre en cache.

Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
"""

import hashlib
import json
from typing import Any

from inspect_ai.model import ChatMessageSystem, ChatMessageUser, Model

from playground.eval_schemas import ToolSpec
from playground.shared_data import load

_SHARED = load("world-prompt")
"""Le prompt de l'environnement et le modèle qui le porte, partagés.

L'interface les lit pour compter leurs jetons dans le devis. Si elle en gardait
sa propre copie, le devis finirait par chiffrer autre chose que ce qui part —
un mensonge que personne ne verrait. Les changer se fait dans
`shared/world-prompt.json`.
"""

WORLD_MODEL: str = _SHARED["model"]
"""Le modèle qui sert les appels, en dur.

Pas un champ de configuration, et c'est un choix : ce qu'on lui demande n'est
pas de l'intelligence mais de l'obéissance — ne rien rendre qui ne soit pas
dans le monde — et laisser choisir n'ouvrirait qu'une façon de plus de rendre
un run incomparable à un autre. Le rendre configurable plus tard n'est qu'un
champ à ajouter ; le retirer après coup serait une migration.
"""

WORLD_SYSTEM: str = _SHARED["system"]


def arguments_key(arguments: dict[str, Any]) -> str:
    """Les arguments d'un appel, sous leur forme canonique.

    Les clés sont triées : un modèle qui rend `{"b": 2, "a": 1}` et un autre
    qui rend `{"a": 1, "b": 2}` ont fait le même appel, et doivent recevoir la
    même réponse. Sans ce tri, deux répétitions du même scénario rateraient le
    cache et verraient deux mondes.

    `ensure_ascii=False` pour que la forme reste lisible quand on relit une
    ligne de `tool_results` six mois plus tard.
    """
    return json.dumps(arguments or {}, sort_keys=True, ensure_ascii=False)


def result_key(tool_name: str, arguments: dict[str, Any]) -> str:
    """L'identité d'un appel servi, telle qu'elle vit en clé primaire.

    Un hachage plutôt que les arguments eux-mêmes : ils peuvent porter une
    requête de plusieurs kilo-octets, et c'est une colonne d'index. Les
    arguments lisibles voyagent à côté, dans leur propre colonne, pour qu'on
    puisse encore relire ce qui a été demandé.

    Le nom de l'outil entre dans le hachage : deux outils appelés sans argument
    ne partagent pas leur réponse.
    """
    empreinte = f"{tool_name}\n{arguments_key(arguments)}"
    return hashlib.sha256(empreinte.encode("utf-8")).hexdigest()


def world_prompt(
    world: str,
    scenario_world: str,
    tool: ToolSpec,
    arguments: dict[str, Any],
) -> tuple[str, str]:
    """Le message système et le message utilisateur envoyés à l'environnement.

    La signature est la liste close de ce que le modèle voit — voir la
    docstring du module. Elle n'accepte aucun autre argument, et c'est
    volontaire : le jour où quelqu'un voudra lui passer la conversation, il
    devra changer cette ligne, lire pourquoi, et assumer d'avoir tué le cache.

    Le bloc du scénario n'est écrit que s'il porte du texte. Un en-tête suivi
    de rien serait du bruit, et un modèle y chercherait un sens.

    Returns:
        Le couple (système, utilisateur).
    """
    blocs = [_SHARED["world_block"].format(world=world.strip())]
    if scenario_world.strip():
        blocs.append(
            _SHARED["scenario_block"].format(scenario_world=scenario_world.strip())
        )
    blocs.append(
        _SHARED["call_block"].format(
            tool=tool.name, arguments=arguments_key(arguments)
        )
    )
    if tool.retrieval_rules.strip():
        blocs.append(
            _SHARED["rules_block"].format(rules=tool.retrieval_rules.strip())
        )
    return WORLD_SYSTEM, _SHARED["separator"].join(blocs)


async def serve(
    model: Model,
    world: str,
    scenario_world: str,
    tool: ToolSpec,
    arguments: dict[str, Any],
) -> str:
    """Ce que l'outil rend pour cet appel.

    Un appel de modèle, sans outil de sortie : ce qu'on veut est le texte
    lui-même, pas un champ dans un schéma. Le juge, lui, appelle
    `submit_score` parce qu'il doit rendre un nombre choisi dans une liste ;
    ici la sortie *est* la réponse.

    Les blancs de bord sont retirés : un modèle qui encadre sa sortie de sauts
    de ligne produirait un résultat d'outil qui n'a l'air d'aucune interface
    réelle, et c'est exactement le tell qu'on cherche à éviter.
    """
    système, message = world_prompt(world, scenario_world, tool, arguments)
    sortie = await model.generate(
        input=[ChatMessageSystem(content=système), ChatMessageUser(content=message)]
    )
    return sortie.completion.strip()
