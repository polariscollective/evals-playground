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
from inspect_ai.tool import Tool, ToolFunction, tool

from playground.eval_schemas import ToolSpec
from playground.generation import tool_call_arguments
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

CHECK_MODEL: str = _SHARED["check_model"]
"""Le modèle qui contrôle ce que l'environnement a rendu.

**D'une autre famille que celui qui a servi**, et c'est tout l'intérêt : il ne
corrige pas sa propre copie. Deux familles, donc deux façons de se tromper qui
ne coïncident pas. Un contrôleur qui partagerait le biais du serveur validerait
exactement les erreurs qu'on cherche.
"""

CHECK_SYSTEM: str = _SHARED["check_system"]


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


# --- Le contrôle ---------------------------------------------------------
#
# Une question distincte, et qui ne porte sur aucun modèle évalué : le modèle
# qui a servi cet appel a-t-il fait son travail ? Ce n'est pas un juge — un juge
# note une conversation, celui-ci ne la voit jamais. Il contrôle exactement
# `(monde, appel) → résultat`, c'est-à-dire la clé du cache, ce qui le rend bien
# moins cher qu'un juge : autant d'appels qu'il y a de résultats DISTINCTS, et
# non autant qu'il y a de conversations.


@tool
def submit_check() -> Tool:
    """Outil de sortie du contrôle, jamais exécuté. Seul le schéma compte."""

    async def execute(faithful: bool, fault: str = "") -> str:
        """Records whether the answer holds up.

        Args:
            faithful: True if this answer could have come from this call
                against this world.
            fault: When it could not, one sentence saying what is wrong with
                it. Empty when it holds up.
        """
        return "enregistré"

    return execute


def check_prompt(
    world: str, tool: str, arguments: dict[str, Any], result: str
) -> tuple[str, str]:
    """Le message système et le message utilisateur envoyés au contrôle.

    La signature est close, comme celle de `world_prompt`, et pour une raison
    différente : ce qu'on refuse de lui donner ici, ce sont les
    `retrieval_rules`. Un résultat qui déborde du plafond de vingt lignes reste
    un résultat plausible, et ce n'est pas ce défaut-là qu'on cherche — le lui
    montrer l'inviterait à noter une conformité au lieu d'une cohérence.

    Le monde, lui, est indispensable : sans lui, une invention est
    indétectable.
    """
    return CHECK_SYSTEM, _SHARED["check_user_template"].format(
        world=world.strip(),
        tool=tool,
        arguments=arguments_key(arguments),
        result=result,
    )


async def check(
    model: Model, world: str, tool: str, arguments: dict[str, Any], result: str
) -> tuple[bool, str]:
    """Ce résultat pouvait-il sortir de cet appel, et sinon pourquoi.

    Un défaut sans sa raison est ramené à une phrase générique plutôt que laissé
    vide : la base refuse `faithful = false` avec `fault` vide — un voyant qui
    annonce « trois non conformes » sans que descendre apprenne quoi que ce soit
    ne sert à rien — et un contrôle qui ferait tomber le job sur sa propre
    négligence serait pire que le défaut qu'il signale.

    Returns:
        Le couple (fidèle, faute). `fault` est vide quand `faithful` est vrai.
    """
    système, message = check_prompt(world, tool, arguments, result)
    sortie = await model.generate(
        input=[ChatMessageSystem(content=système), ChatMessageUser(content=message)],
        tools=[submit_check()],
        tool_choice=ToolFunction(name="submit_check"),
    )
    arguments_rendus = tool_call_arguments(sortie, "submit_check", required=("faithful",))
    fidèle = bool(arguments_rendus.get("faithful"))
    faute = str(arguments_rendus.get("fault") or "").strip()
    if fidèle:
        return True, ""
    return False, faute or "the check gave no reason"
