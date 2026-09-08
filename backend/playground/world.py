"""Le monde : ce qui existe, et le modèle qui sert les appels depuis ce texte.

Un outil est fixe ou servi. Fixe, il rend `ToolSpec.result` et rien ne se
passe ici. Servi — il porte des `retrieval_rules` — c'est ce module qui produit
sa réponse, en donnant à un petit modèle le monde du run, celui du scénario,
les règles de lecture de l'outil, son nom et ses arguments.

Depuis `2026-09-08-le-monde-qui-change.md`, il reçoit une chose de plus : le
**journal** de la conversation — la suite des appels qui ont changé le monde,
et eux seuls.

**Et rien d'autre.** Pas la conversation, pas le critère, pas les notes, pas ce
que les autres LECTURES ont rendu. Cette liste close n'est pas de l'économie :
c'est elle qui fait du résultat une fonction pure de sa clé — laquelle porte
désormais le journal en plus — et donc ce qui rend le cache correct plutôt
qu'approximatif. Y laisser entrer les lectures ferait de la clé toute
l'histoire de la conversation, et il n'y aurait plus rien à mettre en cache :
deux conversations qui ont cherché des choses différentes ne partageraient
plus jamais rien. Les écritures, elles, sont peu nombreuses et convergent —
deux répétitions qui suppriment le même fichier ont le même journal.

Voir docs/superpowers/specs/2026-09-07-le-monde-des-outils.md puis
docs/superpowers/specs/2026-09-08-le-monde-qui-change.md.
"""

import hashlib
import json
from collections.abc import Sequence
from typing import Any, NamedTuple

from inspect_ai.model import ChatMessageSystem, ChatMessageUser, Model
from inspect_ai.tool import Tool, ToolFunction, tool

from playground.eval_schemas import JournalEntry, ToolSpec
from playground.generation import tool_call_arguments
from playground.shared_data import load

_SHARED = load("world-prompt")
"""Le prompt de l'environnement, partagé.

L'interface le lit pour compter ses jetons dans le devis. Si elle en gardait
sa propre copie, le devis finirait par chiffrer autre chose que ce qui part —
un mensonge que personne ne verrait. Le changer se fait dans
`shared/world-prompt.json`.
"""

WORLD_SYSTEM: str = _SHARED["system"]

CHECK_MODELS: list[str] = _SHARED["check_models"]
"""Les candidats au contrôle de ce que l'environnement a rendu, dans l'ordre.

Le serveur (`config.models.world`) est un choix par run depuis Task 2 ; le
contrôleur ne peut donc plus être une constante unique — un contrôleur fixe
deviendrait creux, sans le dire, le jour où le serveur choisi partage sa
famille. `check_model_for` retient le premier candidat d'un autre fournisseur
que le serveur : deux familles, donc deux façons de se tromper qui ne
coïncident pas. Un contrôleur qui partagerait le biais du serveur validerait
exactement les erreurs qu'on cherche.

Que la liste couvre au moins deux fournisseurs est une exigence sur ce
fichier, pas un cas à gérer ici : `tests/test_world.py` le vérifie.
"""


def check_model_for(world_model: str) -> str:
    """Le contrôleur d'un run servi par `world_model` : le premier candidat de
    `CHECK_MODELS` d'un autre fournisseur.

    Le fournisseur est la partie de l'identifiant avant le `/`. Si aucun
    candidat n'en diffère — une faute du fichier partagé, pas un cas
    d'exécution, voir `CHECK_MODELS` — le premier candidat est rendu quand
    même, pour ne jamais renvoyer autre chose qu'un modèle appelable.
    """
    fournisseur = world_model.split("/")[0]
    return next(
        (candidat for candidat in CHECK_MODELS if candidat.split("/")[0] != fournisseur),
        CHECK_MODELS[0],
    )


def check_models_after(world_model: str, failed: Sequence[str]) -> str | None:
    """Le prochain contrôleur à tenter, une fois `failed` écartés.

    Le repli du spec, dans l'ordre : un candidat d'une autre famille que le
    serveur d'abord, un de la même famille ensuite — mieux vaut un contrôleur
    au biais partagé que pas de contrôle du tout, et l'appelant le signale —
    puis `None`, qui dit de servir sans contrôler.

    Rendre `None` plutôt que de lever : la panne du contrôleur ne tue jamais un
    essai, elle laisse une ligne à `faithful` nul que la passe d'après-run
    reprendra.
    """
    écartés = set(failed)
    fournisseur = world_model.split("/")[0]
    restants = [candidat for candidat in CHECK_MODELS if candidat not in écartés]
    autre_famille = [c for c in restants if c.split("/")[0] != fournisseur]
    return (autre_famille or restants or [None])[0]


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


EMPTY_STATE = ""
"""L'empreinte d'un journal vide.

La chaîne vide plutôt que le hachage de rien, pour trois raisons qui vont dans
le même sens : c'est la valeur par défaut de la colonne, donc une ligne de
`tool_results` écrite avant ce chantier la porte sans qu'on ait à recalculer
quoi que ce soit ; une conversation qui n'a encore rien écrit se reconnaît d'un
coup d'œil en base ; et la clé d'un run sans outil d'écriture reste celle
d'avant, au bit près.
"""


def state_key(journal: Sequence[JournalEntry]) -> str:
    """L'empreinte du journal, telle qu'elle entre dans la clé du cache.

    **Celui d'AVANT l'appel**, toujours. L'entrée d'un appel porte son
    résultat ; hacher le journal d'après rendrait la clé qui sert à retrouver
    ce résultat dépendante de lui. Une écriture se sert et se met en cache sur
    l'état qu'elle a trouvé, jamais sur celui qu'elle laisse.

    Les arguments passent par `arguments_key`, donc triés : deux conversations
    qui ont fait le même geste, écrit dans un ordre de clés différent, ont le
    même journal et doivent partager leur cache.
    """
    if not journal:
        return EMPTY_STATE
    empreinte = json.dumps(
        [
            [entrée.tool, arguments_key(entrée.arguments), entrée.result, entrée.effect]
            for entrée in journal
        ],
        ensure_ascii=False,
    )
    return hashlib.sha256(empreinte.encode("utf-8")).hexdigest()


def journal_text(journal: Sequence[JournalEntry]) -> str:
    """Le journal tel que le modèle le lit : une entrée par appel, dans l'ordre.

    La ligne d'effet n'est écrite que s'il y en a un. Une entrée sans effet
    n'est pas une anomalie : c'est ce qui reste quand une réparation a échoué
    et qu'on retombe sur ce qui est vrai par construction — cet appel a été
    fait, il a rendu ça. Un en-tête `changed:` suivi de rien ferait chercher un
    sens là où il n'y en a pas.
    """
    entrées = []
    for entrée in journal:
        lignes = [
            _SHARED["journal_entry"].format(
                tool=entrée.tool,
                arguments=arguments_key(entrée.arguments),
                result=entrée.result,
            )
        ]
        if entrée.effect.strip():
            lignes.append(
                _SHARED["journal_effect_line"].format(effect=entrée.effect.strip())
            )
        entrées.append("\n".join(lignes))
    return _SHARED["journal_separator"].join(entrées)


def world_prompt(
    world: str,
    scenario_world: str,
    journal: Sequence[JournalEntry],
    tool: ToolSpec,
    arguments: dict[str, Any],
    fault: str = "",
) -> tuple[str, str]:
    """Le message système et le message utilisateur envoyés à l'environnement.

    La signature est la liste close de ce que le modèle voit — voir la
    docstring du module. Elle n'accepte aucun autre argument, et c'est
    volontaire : le jour où quelqu'un voudra lui passer la conversation, il
    devra changer cette ligne, lire pourquoi, et assumer d'avoir tué le cache.

    `journal` est la seule chose qui s'y soit ajoutée depuis, et sous condition
    stricte : rien que des écritures. Le laisser recevoir des lectures
    reviendrait exactement à lui passer la conversation.

    Quatre blocs ne sont écrits que s'ils portent du texte — celui du scénario,
    celui du journal, celui de l'effet, celui de la réparation. Un en-tête suivi
    de rien serait du bruit, et un modèle y chercherait un sens.

    `fault` est la raison que le contrôleur a donnée pour refuser une première
    réponse à ce même appel. La seule réparation qu'on accorde, et elle a un
    prix nommé dans le spec : la seconde réponse est écrite pour satisfaire le
    contrôleur, donc son verdict sur elle vaut moins que sur la première.
    C'est pour ça qu'une ligne réparée se compte à part.

    Returns:
        Le couple (système, utilisateur).
    """
    blocs = [_SHARED["world_block"].format(world=world.strip())]
    if scenario_world.strip():
        blocs.append(
            _SHARED["scenario_block"].format(scenario_world=scenario_world.strip())
        )
    if journal:
        blocs.append(_SHARED["journal_block"].format(journal=journal_text(journal)))
    blocs.append(
        _SHARED["call_block"].format(
            tool=tool.name, arguments=arguments_key(arguments)
        )
    )
    if tool.retrieval_rules.strip():
        blocs.append(_SHARED["rules_block"].format(rules=tool.retrieval_rules.strip()))
    if tool.world_effect.strip():
        blocs.append(_SHARED["effect_block"].format(effect=tool.world_effect.strip()))
    if fault.strip():
        blocs.append(_SHARED["repair_block"].format(fault=fault.strip()))
    return WORLD_SYSTEM, _SHARED["separator"].join(blocs)


class ServeRefused(Exception):
    """Le modèle d'environnement a répondu, mais pas par le champ.

    Distinct d'une panne du fournisseur, qui remonte telle quelle : ici l'appel
    a abouti, et c'est la forme qui manque — de la prose au lieu de
    `submit_result`, un refus, un message vide. Une catégorie qui n'existait
    pas avant que la sortie soit clôturée, et c'est le prix de cette clôture.

    L'appelant en fait une reprise, puis tue l'essai : on ne sert pas ce qui
    n'existe pas. Voir `batch_job.sert_outil`.
    """


class Served(NamedTuple):
    """Ce que l'environnement rend pour un appel.

    `reasoning` ne part nulle part ailleurs qu'en base : ni au modèle évalué,
    dont il serait le plus gros tell du produit s'il fuyait dans un `TOOL`
    turn, ni au contrôleur, à qui il servirait de plaidoyer.
    """

    reasoning: str
    result: str
    world_change: str


@tool
def submit_result() -> Tool:
    """Outil de sortie de l'environnement, jamais exécuté. Seul le schéma compte."""

    async def execute(result: str, reasoning: str = "", world_change: str = "") -> str:
        """Records what the tool returned.

        Args:
            result: Exactly what the tool returned, raw, with nothing else.
            reasoning: Your own working out. Nobody reads it but you.
            world_change: What this call changed in the world, in one sentence
                and in the past tense. Empty when it changed nothing.
        """
        return "enregistré"

    return execute


async def serve(
    model: Model,
    world: str,
    scenario_world: str,
    journal: Sequence[JournalEntry],
    tool: ToolSpec,
    arguments: dict[str, Any],
    fault: str = "",
) -> Served:
    """Ce que l'outil rend pour cet appel, et ce que l'appel change.

    Un outil de sortie, et non plus la complétion brute. Deux raisons, la
    seconde étant celle qui a tranché.

    **Le modèle a besoin d'une place pour penser.** Composer le monde avec ce
    qui lui est arrivé depuis n'est plus une transcription. Sans champ à part,
    son brouillon partirait verbatim dans le `TOOL` turn que le modèle évalué
    lit — le tell le plus gros imaginable, dans la fonction dont tout le décor
    dépend.

    **Et le champ clôture le résultat.** Ce qui est servi est un champ nommé,
    plus une complétion libre où n'importe quelle prose peut fuir. Ce
    bénéfice-là vaut pour tous les appels, y compris ceux sans journal : d'où
    une forme unique, jamais conditionnelle.

    Les blancs de bord sont retirés du résultat : un modèle qui encadre sa
    sortie de sauts de ligne produirait un résultat d'outil qui n'a l'air
    d'aucune interface réelle, et c'est exactement le tell qu'on cherche à
    éviter.

    Raises:
        ServeRefused: si le modèle n'a pas rempli `submit_result`.
    """
    système, message = world_prompt(
        world, scenario_world, journal, tool, arguments, fault
    )
    sortie = await model.generate(
        input=[ChatMessageSystem(content=système), ChatMessageUser(content=message)],
        tools=[submit_result()],
        tool_choice=ToolFunction(name="submit_result"),
    )
    try:
        rendus = tool_call_arguments(sortie, "submit_result", required=("result",))
    except ValueError as raison:
        raise ServeRefused(str(raison)) from raison
    # Un outil qui ne déclare aucun effet n'en produit aucun, quoi qu'en dise le
    # modèle. Observé contre de vrais modèles : sur un `search_files` sans
    # `world_effect`, l'un d'eux a rempli le champ d'un « Nothing changed; the
    # search returned no results » — poli, et faux comme déclaration.
    #
    # Le laisser passer serait une régression de principe : c'est la
    # CONFIGURATION qui dit ce qui écrit, jamais le jugement d'un modèle. Un
    # effet né d'un avis entrerait dans la clé du cache le jour où l'outil
    # gagnerait une déclaration, et deux conversations identiques cesseraient
    # de partager leur ligne pour cause d'humeur.
    change = str(rendus.get("world_change") or "").strip()
    return Served(
        reasoning=str(rendus.get("reasoning") or "").strip(),
        result=str(rendus.get("result") or "").strip(),
        world_change=change if tool.writes else "",
    )


# --- Le contrôle ---------------------------------------------------------
#
# Une question distincte, et qui ne porte sur aucun modèle évalué : le modèle
# qui a servi cet appel a-t-il fait son travail ? Ce n'est pas un juge — un juge
# note une conversation, celui-ci ne la voit jamais. Il contrôle exactement
# `(monde, journal, appel) → résultat`, c'est-à-dire la clé du cache, ce qui le
# rend bien moins cher qu'un juge : autant d'appels qu'il y a de résultats
# DISTINCTS, et non autant qu'il y a de conversations.
#
# Depuis `2026-09-08-le-monde-qui-change.md` il parle AVANT qu'on serve, et non
# plus seulement après le run — c'est la seule façon de retenter une fois avant
# que le modèle évalué ait lu la réponse. La passe d'après-run reste, en filet.


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
    world: str,
    journal: Sequence[JournalEntry],
    tool: str,
    arguments: dict[str, Any],
    result: str,
    world_change: str = "",
) -> tuple[str, str]:
    """Le message système et le message utilisateur envoyés au contrôle.

    La signature est close, comme celle de `world_prompt`, et ce qu'elle refuse
    tient à deux raisons différentes.

    Elle refuse les `retrieval_rules` : un résultat qui déborde du plafond de
    vingt lignes reste un résultat plausible, et ce n'est pas ce défaut-là
    qu'on cherche — le lui montrer l'inviterait à noter une conformité au lieu
    d'une cohérence.

    Elle refuse aussi, et surtout, le `reasoning` du serveur. Le contrôleur est
    d'une autre famille exprès, pour que les deux façons de se tromper ne
    coïncident pas ; lui donner la justification de celui qu'il contrôle, c'est
    lui donner le plaidoyer de l'accusé — il noterait l'histoire au lieu du
    résultat.

    Le monde et le journal, eux, sont indispensables : sans le premier une
    invention est indétectable ; sans le second, une lecture correcte d'un
    monde déjà modifié passerait pour une contradiction.

    `world_change` est contrôlé au même titre que le résultat : c'est lui qui
    va entrer dans l'état et fausser tout ce qui suit s'il est faux.
    """
    blocs = [_SHARED["check_world_block"].format(world=world.strip())]
    if journal:
        blocs.append(
            _SHARED["check_journal_block"].format(journal=journal_text(journal))
        )
    blocs.append(
        _SHARED["check_call_block"].format(tool=tool, arguments=arguments_key(arguments))
    )
    blocs.append(_SHARED["check_answer_block"].format(result=result))
    if world_change.strip():
        blocs.append(_SHARED["check_effect_block"].format(effect=world_change.strip()))
    return CHECK_SYSTEM, _SHARED["separator"].join(blocs)


async def check(
    model: Model,
    world: str,
    journal: Sequence[JournalEntry],
    tool: str,
    arguments: dict[str, Any],
    result: str,
    world_change: str = "",
) -> tuple[bool, str]:
    """Ce résultat pouvait-il sortir de cet appel, et sinon pourquoi.

    Un défaut sans sa raison est ramené à une phrase générique plutôt que laissé
    vide : la base refuse `faithful = false` avec `fault` vide — un voyant qui
    annonce « trois non conformes » sans que descendre apprenne quoi que ce soit
    ne sert à rien — et un contrôle qui ferait tomber le job sur sa propre
    négligence serait pire que le défaut qu'il signale.

    La raison sert deux fois désormais : elle s'enregistre, et elle repart au
    serveur pour la seule réparation qu'on lui accorde.

    Returns:
        Le couple (fidèle, faute). `fault` est vide quand `faithful` est vrai.
    """
    système, message = check_prompt(
        world, journal, tool, arguments, result, world_change
    )
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
