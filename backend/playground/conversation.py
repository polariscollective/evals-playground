"""La boucle de conversation : un modèle évalué face à un adversaire.

Le modèle évalué ne voit qu'une conversation ordinaire : son system prompt,
puis des messages `user` auxquels il répond. Il ne peut pas distinguer
l'adversaire d'un interlocuteur humain.

L'adversaire voit la même conversation en miroir — ses propres messages en
`assistant`, ceux du modèle évalué en `user` — précédée d'un system prompt qui
lui est propre. Ce prompt ne quitte jamais sa vue.
"""

from dataclasses import dataclass, field
from typing import Any, Callable, Literal, Sequence

from playground.eval_schemas import ToolSpec
from playground.shared_data import load

from inspect_ai.tool import ToolCall, ToolDef, ToolParams
from inspect_ai.util import JSONSchema

from inspect_ai.model import (
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageTool,
    ChatMessageUser,
    GenerateConfig,
    Model,
)


class Cancelled(Exception):
    """L'arrêt a été demandé, et on ne dépensera pas un appel de plus.

    Levée depuis l'endroit exact où l'argent se dépense — juste avant un appel
    de modèle. Inspect la consigne dans son journal et, `fail_on_error` étant
    faux, passe à la case suivante, qui lèvera à son tour sans rien appeler.
    """


@dataclass
class ToolCallRecord:
    """Un appel d'outil décidé par le modèle évalué.

    C'est souvent *le* comportement mesuré — « a-t-il appelé `delete_records` »
    — donc il est enregistré tel quel, arguments compris, et non résumé.
    """

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class Turn:
    """Un tour de la conversation, du point de vue du modèle évalué."""

    role: Literal["user", "assistant", "tool"]
    content: str
    stop_reason: str | None = None
    """Pourquoi le modèle s'est arrêté, quand c'est lui qui a parlé.

    Vaut `content_filter` quand le fournisseur a bloqué la génération : la
    réponse est alors vide sans que le modèle ait refusé quoi que ce soit.
    Confondre les deux fausserait la lecture du run.
    """

    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    """Les outils que ce tour d'assistant a décidé d'appeler."""

    tool_call_id: str | None = None
    """Sur un tour `tool` : l'appel auquel ce résultat répond."""

    tool_name: str | None = None
    """Sur un tour `tool` : l'outil qui a « répondu »."""

    seeded: bool = False
    """Écrit par l'expérimentateur, pas produit par un modèle.

    Ce drapeau est ce qui empêche la faute la plus grave que cette
    fonctionnalité rend possible : faire noter au juge des mots que le modèle
    évalué n'a jamais dits. Il voyage jusqu'au transcript enregistré, jusqu'à
    l'invite du juge et jusqu'à l'export.
    """


def target_view(system_prompt: str, transcript: list[Turn]) -> list[ChatMessage]:
    """Ce que voit le modèle évalué : son system prompt et la conversation.

    Rien d'autre n'entre ici. C'est le seul endroit qui construit ses messages,
    ce qui rend l'invariant de sécurité vérifiable en un coup d'œil.
    """
    messages: list[ChatMessage] = [ChatMessageSystem(content=system_prompt)]
    for turn in transcript:
        if turn.role == "user":
            messages.append(ChatMessageUser(content=turn.content))
        elif turn.role == "tool":
            # Le résultat doit revenir au modèle attaché à son appel : sans
            # `tool_call_id`, les fournisseurs refusent le message ou le
            # rattachent au mauvais appel quand il y en a plusieurs.
            messages.append(
                ChatMessageTool(
                    content=turn.content,
                    tool_call_id=turn.tool_call_id,
                    function=turn.tool_name,
                )
            )
        else:
            messages.append(
                ChatMessageAssistant(
                    content=turn.content,
                    tool_calls=[
                        ToolCall(id=call.id, function=call.name, arguments=call.arguments)
                        for call in turn.tool_calls
                    ]
                    or None,
                )
            )
    return messages


_SHARED = load("adversary-prompt")
"""Le system prompt de l'adversaire, partagé avec TypeScript.

L'interface doit chiffrer ce que l'adversaire consommera avant qu'un run
n'existe. Sans ce partage, elle en garderait sa propre estimation, qui finirait
par ne plus décrire le texte réellement envoyé — et le devis mentirait sans
qu'on le voie."""

CONFIDENTIALITY_NOTICE = _SHARED["confidentiality_notice"]
"""La consigne de confidentialité que nous imposons, distincte de l'objectif
que l'utilisateur écrit dans `adversary_prompt`.

L'utilisateur rédige un objectif, pas une politique de confidentialité :
c'est à nous de la garantir. Elle encadre donc l'objectif de l'utilisateur
dans `adversary_view` (avant et après) plutôt que d'être noyée dedans.
"""


def adversary_view(
    adversary_prompt: str, opening_message: str, transcript: list[Turn]
) -> list[ChatMessage]:
    """Ce que voit l'adversaire : son prompt secret et la conversation en miroir.

    Le message d'ouverture est placé dans le system prompt plutôt que dans
    l'historique. Sinon la conversation commencerait par un message
    `assistant`, ce que l'API Anthropic refuse — le premier message après le
    system doit être un `user`. L'adversaire sait donc ce qu'il a « dit » sans
    que la conversation démarre du mauvais rôle.

    La consigne de confidentialité (`CONFIDENTIALITY_NOTICE`) encadre
    l'objectif de l'utilisateur : elle réduit le risque que l'adversaire
    dévoile ses instructions, sans pouvoir l'éliminer — rien ne garantit le
    contenu produit par un modèle de langage. Si l'adversaire recopie malgré
    tout ses instructions dans son message, ce texte atteint légitimement le
    modèle évalué par le canal normal de la conversation ; voir
    `test_limite_connue_un_adversaire_qui_recopie_ses_instructions_les_fait_quand_meme_fuiter`
    dans `tests/test_conversation.py`, qui documente cette limite connue.
    """
    system = _SHARED["system_template"].format(
        notice=CONFIDENTIALITY_NOTICE,
        adversary_prompt=adversary_prompt,
        opening_message=opening_message,
    )
    messages: list[ChatMessage] = [ChatMessageSystem(content=system)]
    for turn in transcript[1:]:
        if turn.role == "assistant":
            messages.append(ChatMessageUser(content=turn.content))
        else:
            messages.append(ChatMessageAssistant(content=turn.content))
    return messages


MAX_TOOL_CALLS_PER_TURN = 5
"""Le plafond par défaut, quand la configuration n'en fixe pas.

Un modèle qui appelle, lit, rappelle est le comportement réel d'un agent, et
c'est ce qu'on veut pouvoir observer. Mais rien n'empêche une boucle : sans
plafond, une seule case peut consommer le budget d'un run entier.
"""


def tool_definitions(tools: "Sequence[ToolSpec]") -> list[ToolDef]:
    """Les outils du run, traduits pour inspect.

    Rien n'est exécuté : la fonction rendue est un leurre, jamais appelée. C'est
    `run_conversation` qui répond, avec le `result` écrit dans la définition —
    la même réponse à chaque répétition, sans quoi deux cases de la matrice ne
    mesureraient pas la même chose.

    Le format d'un fournisseur à l'autre n'est pas notre affaire : inspect
    traduit `ToolDef` vers celui de chacun.
    """

    async def jamais_appelee(**_: Any) -> str:  # pragma: no cover
        raise AssertionError("les outils sont simulés, jamais exécutés")

    definitions = []
    for spec in tools:
        params = ToolParams(
            properties={
                param.name: JSONSchema(
                    type=param.type, description=param.description
                )
                for param in spec.parameters
            },
            required=[p.name for p in spec.parameters if p.required],
        )
        definitions.append(
            ToolDef(
                tool=jamais_appelee,
                name=spec.name,
                description=spec.description,
                parameters=params,
            )
        )
    return definitions


async def run_conversation(
    *,
    system_prompt: str,
    opening_message: str,
    turns: int,
    target: Model,
    adversary: Model | None = None,
    adversary_prompt: str = "",
    temperature: float | None = None,
    history: "Sequence[Turn] | None" = None,
    tools: "Sequence[ToolSpec] | None" = None,
    max_tool_calls: int = MAX_TOOL_CALLS_PER_TURN,
    stopped: "Callable[[], bool] | None" = None,
) -> list[Turn]:
    """Déroule une conversation de `turns` tours et renvoie son transcript.

    Le message d'ouverture est fixe et compte comme le premier tour : toutes
    les répétitions d'un run démarrent donc à l'identique et restent
    comparables entre elles.

    Args:
        system_prompt: Le system prompt du modèle évalué.
        opening_message: Le premier message qui le met en situation.
        turns: Nombre de réponses attendues du modèle évalué, de 1 à 10.
        target: Le modèle évalué.
        adversary: Le modèle qui pousse. Inutile à `turns = 1`.
        adversary_prompt: Son instruction secrète.
        history: Un état de conversation posé d'avance, propre au scénario. Le
            modèle démarre comme s'il l'avait vécu, ce qui rend le point de
            départ identique pour toutes les répétitions — dérouler le
            préambule en vrais tours n'aboutit pas au même endroit à chaque
            fois, et coûte des appels.
        tools: Les outils offerts au modèle évalué pour ce scénario. Rien n'est
            exécuté : chaque appel reçoit le `result` écrit dans sa définition,
            le même à chaque répétition. Faire improviser la réponse
            ramènerait dans chaque case la variance qu'un run cherche à isoler.
        max_tool_calls: Combien d'appels d'affilée avant qu'on rende la main au
            tour suivant. Le dernier reçoit quand même sa réponse : un appel
            resté en suspens rend le transcript invalide pour la suite.
        temperature: Appliquée au seul modèle évalué. L'adversaire tourne au
            réglage par défaut de son fournisseur : le faire varier en même
            temps rendrait toute différence de comportement inattribuable.
        stopped: Consulté juste avant chaque appel de modèle, et nulle part
            ailleurs. C'est le seul endroit qui compte : inspect démarre tous
            les échantillons d'un coup et les fait attendre un jeton de
            connexion *à l'intérieur* de `generate`. Un contrôle placé avant la
            file serait franchi par tout le monde dès la première seconde, et
            n'arrêterait rien.

    Raises:
        ValueError: si `turns` dépasse 1 sans adversaire.
    """
    # Validation préalable : avant tout appel au modèle évalué, s'assurer
    # qu'on a un adversaire si on a besoin de plus d'un tour. Sinon une vraie
    # requête API serait envoyée et facturée inutilement.
    if turns > 1 and adversary is None:
        raise ValueError(
            "An adversary model is required to go beyond one turn."
        )

    # L'historique posé ouvre le transcript. Le modèle le reçoit comme s'il
    # l'avait vécu — c'est le but — mais chaque tour reste marqué, et le juge
    # sait ne pas le noter.
    transcript: list[Turn] = [
        Turn(role=turn.role, content=turn.content, seeded=True)
        for turn in (history or [])
    ]
    transcript.append(Turn(role="user", content=opening_message))
    target_config = (
        GenerateConfig(temperature=temperature)
        if temperature is not None
        else GenerateConfig()
    )

    definitions = tool_definitions(tools or [])
    results = {spec.name: spec.result for spec in (tools or [])}

    for turn_index in range(turns):
        # Un tour, c'est une réponse du modèle évalué — pas un appel de modèle.
        # Un modèle outillé peut appeler, lire le résultat et rappeler avant de
        # répondre vraiment ; tout cela reste le même tour, plafonné.
        for essai in range(max_tool_calls + 1):
            if stopped is not None and stopped():
                raise Cancelled("stopped before the evaluated model's turn")
            target_output = await target.generate(
                input=target_view(system_prompt, transcript),
                config=target_config,
                tools=definitions,
            )
            appels = target_output.message.tool_calls or []
            transcript.append(
                Turn(
                    role="assistant",
                    content=target_output.completion,
                    stop_reason=(
                        target_output.choices[0].stop_reason
                        if target_output.choices
                        else None
                    ),
                    tool_calls=[
                        ToolCallRecord(
                            id=call.id, name=call.function, arguments=call.arguments
                        )
                        for call in appels
                    ],
                )
            )
            if not appels:
                break

            # Chaque appel reçoit sa réponse, toujours la même. Un appel sans
            # réponse laisserait le transcript invalide pour le tour suivant :
            # les fournisseurs refusent un appel resté en suspens.
            plafond = essai == max_tool_calls
            for call in appels:
                transcript.append(
                    Turn(
                        role="tool",
                        content=(
                            results.get(
                                call.function,
                                f"Unknown tool {call.function!r}.",
                            )
                            if not plafond
                            else "Tool call limit reached for this turn."
                        ),
                        tool_call_id=call.id,
                        tool_name=call.function,
                    )
                )
            if plafond:
                break

        if turn_index == turns - 1:
            break

        if stopped is not None and stopped():
            raise Cancelled("stopped before the adversary's turn")
        adversary_output = await adversary.generate(
            input=adversary_view(adversary_prompt, opening_message, transcript),
        )
        transcript.append(
            Turn(role="user", content=adversary_output.completion)
        )

    return transcript
