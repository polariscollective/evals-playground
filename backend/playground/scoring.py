"""Le juge : la question de l'utilisateur, notée sur l'échelle qu'il a écrite.

Une note plutôt qu'un verdict figé. La question posée par un run reste « combien
de fois sur N », mais ce que « une fois » veut dire n'appartient plus au code :
l'utilisateur écrit ses paliers, le juge en choisit un, la matrice en fait une
moyenne. Le code ne connaît que des nombres et les phrases qui vont avec.
"""

from dataclasses import dataclass, field
from typing import Any, Callable

from inspect_ai.model import ChatMessageSystem, ChatMessageUser, get_model
from inspect_ai.model._model import sample_model_usage
from inspect_ai.scorer import Score, Scorer, Target, scorer
from inspect_ai.solver import TaskState
from inspect_ai.tool import Tool, ToolFunction, tool

from playground.eval_schemas import EvalRunConfig, RubricLevel
from playground.generation import tool_call_arguments
from playground.shared_data import load

_SHARED = load("judge-prompt")
"""Le message système et le gabarit du message utilisateur, partagés.

L'interface les lit pour montrer, avant le lancement, ce que le juge recevra.
Si elle en gardait sa propre copie, l'aperçu finirait par décrire un prompt qui
n'est plus celui qui part — un mensonge que personne ne verrait. Les changer se
fait dans `shared/judge-prompt.json`.
"""

UNJUDGED = "unjudged"
"""Valeur du score quand le juge n'a rendu aucune note de l'échelle."""


@dataclass
class ScoredSample:
    """Une case de la matrice, telle que le juge vient de la laisser.

    Ce que le scorer sait d'une répétition au moment où il la termine : d'où
    elle vient dans la matrice, ce qu'elle a produit, et ce qu'elle vaut. C'est
    le seul instant où ces trois choses sont réunies — le journal d'inspect les
    sépare, et attendre la fin du run pour les rassembler ferait perdre la
    progression et tout ce qu'un job mort emporterait avec lui.
    """

    scenario_index: int
    target: str
    repetition: int
    temperature: float | None = None
    score: float | None = None
    justification: str = ""
    messages: list[dict] = field(default_factory=list)

    usage: dict[str, dict[str, int]] = field(default_factory=dict)
    """Jetons consommés par cette case, par modèle.

    Relevé ici et non à la fin du run : `sample_model_usage()` répond pour la
    case en cours, et c'est le seul instant où l'attribution est certaine. Le
    total du run devient alors une addition, plutôt qu'un second chiffre à tenir
    d'accord avec le premier.

    Le juge est compté dedans : il est appelé juste au-dessus, dans le même
    échantillon. C'est voulu — le coût d'une case, c'est tout ce qu'il a fallu
    dépenser pour obtenir sa note.
    """

    error: str | None = None
    """Ce qui a cassé, si quelque chose a cassé.

    Distinct d'une note absente : une conversation bloquée par le fournisseur
    et un juge répondant hors de l'échelle sont des cases traitées, sans note.
    Un juge qui n'appelle pas son outil, lui, est une panne — et la matrice doit
    pouvoir les compter séparément.
    """

JUDGE_SYSTEM = _SHARED["system"]


def format_value(value: float) -> str:
    """La note telle qu'on l'écrit au juge et à l'écran.

    Un entier reste un entier : `2` et non `2.0`. L'échelle est écrite à la
    main, souvent en nombres ronds, et une décimale parasite dans le prompt
    invite le juge à répondre autre chose que ce qu'on lui a proposé.
    """
    return str(int(value)) if float(value).is_integer() else str(value)


def render_rubric(rubric: list[RubricLevel]) -> str:
    """L'échelle mise en forme pour le prompt, de la note la plus basse à la plus haute.

    Triée quel que soit l'ordre de saisie : une échelle présentée dans le
    désordre se lit comme une liste d'options sans progression, alors que
    l'ordre est précisément ce qui en fait une échelle.
    """
    return "\n".join(
        _SHARED["rubric_line"].format(
            value=format_value(level.value), meaning=level.meaning
        )
        for level in sorted(rubric, key=lambda level: level.value)
    )


def render_transcript(messages: list[dict[str, Any]]) -> str:
    """Met le transcript en forme pour le juge, tours numérotés.

    La numérotation permet au juge de citer un tour précis, ce qui rend sa note
    vérifiable sans relire toute la conversation.
    """
    lines = []
    for index, message in enumerate(messages, start=1):
        role = message.get("role")
        if role == "user":
            speaker = "USER"
        elif role == "assistant":
            speaker = "ASSISTANT"
        else:
            # Aucun chemin actuel ne peut produire un autre rôle, les types en
            # amont l'interdisent. Mais si cela arrivait, le confondre avec
            # l'assistant serait la faute la plus grave possible ici : le
            # juge attribuerait au modèle évalué un comportement qui n'est
            # pas le sien. Autant l'étiqueter par son propre nom.
            speaker = str(role).upper()
        # Le marquage est la garde de tout l'historique posé : sans lui le juge
        # noterait le modèle pour des mots écrits par l'expérimentateur. La
        # mention est dans le libellé du tour, pas dans une note en bas de
        # transcript, pour qu'elle ne puisse pas être perdue de vue.
        pose = ", given as context" if message.get("seeded") else ""
        lines.append(
            f"{speaker} [turn {index}{pose}]: {message.get('content', '')}"
        )
    return "\n\n".join(lines)


def score_prompt(
    transcript_text: str, criterion: str, rubric: list[RubricLevel]
) -> str:
    """Le message utilisateur envoyé au juge.

    Rien n'y explique ce que valent les notes en dehors de ce que l'utilisateur
    en a dit : c'est tout l'objet de l'échelle. Le gabarit se contente de poser
    sa question, la conversation, ses paliers, et d'exiger un choix parmi eux.
    """
    ordonnee = sorted(rubric, key=lambda level: level.value)
    return _SHARED["user_template"].format(
        criterion=criterion,
        transcript=transcript_text,
        rubric=render_rubric(rubric),
        values=_SHARED["value_separator"].join(
            _SHARED["value_template"].format(value=format_value(level.value))
            for level in ordonnee
        ),
    )


@tool
def submit_score() -> Tool:
    """Outil de sortie du juge, jamais exécuté. Seul le schéma compte."""

    async def execute(score: float, justification: str) -> str:
        """Records the grade for the conversation.

        Args:
            score: Exactly one of the values listed in the grading scale.
            justification: One sentence justifying the grade, citing the turn
                number involved.
        """
        return "enregistré"

    return execute


def parse_score(value: Any, rubric: list[RubricLevel]) -> float | None:
    """Ramène la réponse du juge à l'une des notes de l'échelle.

    Une note donnée en chaîne (`"2"`, `"0.5"`) est acceptée : les modèles le
    font couramment, et la virgule décimale française avec (`"0,5"`). Un
    booléen est refusé — `float(True)` vaut 1.0, ce qui ferait passer un
    non-nombre pour une note.

    Renvoie `None` pour tout ce qui ne tombe pas exactement sur un palier :
    mieux vaut une répétition sans note, visible dans la matrice, qu'une note
    inventée ou arrondie au palier voisin. Le juge a reçu la liste des valeurs
    admises ; en sortir est un refus de la consigne, pas une approximation.

    La comparaison est faite à une tolérance près, sans quoi une échelle par
    quarts de point serait à la merci de la représentation binaire des
    flottants : `0.1 + 0.2` ne vaut pas `0.3`.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
    try:
        grade = float(value)
    except (TypeError, ValueError):
        return None
    for level in rubric:
        if abs(level.value - grade) < 1e-9:
            return level.value
    return None


def blocking_reason(transcript: list[dict]) -> str | None:
    """Pourquoi cette conversation ne peut pas être jugée, ou None si elle le peut.

    Un modèle dont le fournisseur a bloqué la génération n'a rien dit : ni
    cédé, ni tenu. Le juge, lui, notera tout de même — on l'a vu produire un
    verdict sur une conversation vide, en le justifiant par le fait qu'elle
    était vide. Cette note inventée compterait dans la moyenne comme une vraie.
    Mieux vaut ne pas juger et le dire.
    """
    reponses = [
        message
        for message in transcript
        if message.get("role") == "assistant"
    ]
    if any(str(message.get("content") or "").strip() for message in reponses):
        return None
    if not reponses:
        return "the evaluated model was never called"
    raisons = {
        str(message.get("stop_reason"))
        for message in reponses
        if message.get("stop_reason")
    }
    if raisons == {"content_filter"}:
        return "the provider's content filter blocked every response"
    if raisons:
        return f"the evaluated model returned nothing (stop reason: {', '.join(sorted(raisons))})"
    return "the evaluated model returned nothing"


# Aucune métrique agrégée : la valeur d'un `Score` est ici tantôt un nombre,
# tantôt `UNJUDGED`, et aucune moyenne calculée par inspect sur une colonne
# mêlant les deux ne voudrait dire quoi que ce soit. Ce produit n'utilise pas
# ces métriques — il agrège lui-même dans `matrix.py`, où une répétition non
# notée est comptée séparément plutôt que fondue dans une moyenne.
@scorer(metrics=[])
def rubric_judge(
    config: EvalRunConfig,
    on_scored: Callable[["ScoredSample"], None] | None = None,
    model_args: dict[str, Any] | None = None,
    stopped: Callable[[], bool] | None = None,
) -> Scorer:
    """Fait noter le transcript d'une répétition sur l'échelle du run.

    Args:
        config: La configuration du run, pour le modèle juge, la question et
            l'échelle.
        on_scored: Appelé une fois par répétition tentée, avec ce qu'elle a
            donné — notée ou non. C'est par lui que la case est enregistrée au
            fil de l'eau.
        stopped: Reçu mais **délibérément ignoré**. Voir la note ci-dessous :
            un arrêt ne doit pas jeter une conversation déjà payée.
        model_args: Arguments de construction transmis à `get_model`. Voir la
            docstring de `scenario_solver.model_args` (`generation.py`) pour la
            raison de ce fil explicite : `get_model(nom)` seul ne les reçoit
            pas, puisque `mockllm` est exclu de la mémoïsation par inspect.
    """

    def _sample(
        state: TaskState,
        grade: float | None,
        justification: str,
        error: str | None = None,
    ) -> ScoredSample:
        """La case que ce `TaskState` désigne, telle qu'elle vient d'être notée."""
        metadata = state.metadata or {}
        return ScoredSample(
            scenario_index=int(metadata.get("scenario_index", 0)),
            target=str(metadata.get("target") or ""),
            repetition=int(metadata.get("repetition", 0)),
            temperature=metadata.get("temperature"),
            score=grade,
            justification=justification,
            messages=list(metadata.get("transcript") or []),
            usage={
                nom: {
                    "input_tokens": u.input_tokens or 0,
                    "output_tokens": u.output_tokens or 0,
                    "input_tokens_cache_read": u.input_tokens_cache_read or 0,
                    "input_tokens_cache_write": u.input_tokens_cache_write or 0,
                    "reasoning_tokens": u.reasoning_tokens or 0,
                }
                for nom, u in (sample_model_usage() or {}).items()
            },
            error=error,
        )

    async def score(state: TaskState, target: Target) -> Score:
        transcript = state.metadata.get("transcript") or []
        empeche = blocking_reason(transcript)
        if empeche is not None:
            justification = f"Not judged — {empeche}."
            # La case est enregistrée ici aussi : la répétition a bien été
            # tentée, elle n'a simplement rien à juger. Sans ça elle resterait
            # « à faire » sur un run pourtant terminé.
            if on_scored is not None:
                on_scored(_sample(state, None, justification))
            return Score(
                value=UNJUDGED,
                explanation=justification,
                metadata={"score": None, "justification": justification},
            )

        # Le juge n'est jamais court-circuité par un arrêt, et c'est voulu.
        #
        # Arriver ici veut dire que la conversation a eu lieu, donc qu'elle est
        # payée — c'est elle qui coûte, le juge ne pesant que quelques centaines
        # de jetons. Sauter le jugement économiserait des centimes et rendrait
        # sans valeur ce qu'on vient d'acheter : un transcript sans note ne dit
        # rien, et ne peut même pas entrer dans la moyenne.
        #
        # Mesuré : un essai réel où le juge s'arrêtait aussi a rendu 40 cases
        # « jamais commencées » pour 0,032 $ dépensés, sans une seule note.
        #
        # L'arrêt agit là où l'argent se dépense encore, c'est-à-dire avant les
        # tours du modèle évalué — voir `run_conversation`.
        try:
            output = await get_model(
                config.models.judge, **(model_args or {})
            ).generate(
                input=[
                    ChatMessageSystem(content=JUDGE_SYSTEM),
                    ChatMessageUser(
                        content=score_prompt(
                            render_transcript(transcript),
                            config.criterion,
                            config.rubric,
                        )
                    ),
                ],
                tools=[submit_score()],
                tool_choice=ToolFunction(name="submit_score"),
            )
            arguments = tool_call_arguments(
                output, "submit_score", required=("score",)
            )
            grade = parse_score(arguments.get("score"), config.rubric)
            justification = str(arguments.get("justification") or "")
        except Exception as erreur:
            # Le juge n'a pas répondu comme attendu — outil non appelé, appel
            # en échec. La case est enregistrée non notée, avec la raison, puis
            # l'erreur repart : inspect la consigne dans son journal, et
            # `fail_on_error=False` empêche qu'elle avorte le run entier.
            if on_scored is not None:
                on_scored(
                    _sample(state, None, f"Not judged — {erreur}", error=str(erreur))
                )
            raise

        if on_scored is not None:
            on_scored(_sample(state, grade, justification))

        return Score(
            value=UNJUDGED if grade is None else grade,
            explanation=justification,
            metadata={"score": grade, "justification": justification},
        )

    return score
