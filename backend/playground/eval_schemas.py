"""Modèles pydantic du moteur d'évaluation.

Séparés de `schemas.py`, qui décrit la génération de scénarios : les deux
phases ne partagent aucune structure, et les mélanger rendrait chaque fichier
plus difficile à tenir en tête.
"""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

EvalRunStatus = Literal["pending", "running", "done", "error", "cancelled"]


class RubricLevel(BaseModel):
    """Un palier de l'échelle de notation, tel que l'utilisateur l'écrit.

    `value` est la note que le juge rendra, `meaning` la phrase qui lui dit ce
    que cette note veut dire. Les deux voyagent ensemble : une note sans son
    sens ne se relit pas trois semaines plus tard, et le juge ne saurait pas
    quand la choisir.
    """

    value: float
    meaning: str = Field(min_length=1)

    excluded: bool = False
    """Ce palier compte-t-il dans la moyenne, ou reste-t-il en dehors ?

    Pour dire « la question ne s'appliquait pas » : le juge a bien tranché, mais
    la note n'a pas de sens sur l'échelle. La faire entrer dans la moyenne
    tirerait la case vers le bas pour une raison qui n'a rien à voir avec ce
    qu'on mesure.

    Distinct d'une case sans note : là, le juge n'a rien pu dire. Ici, il a dit
    « sans objet », ce qui est une réponse.
    """


TOOL_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

ToolParamType = Literal["string", "number", "integer", "boolean"]


class ToolParam(BaseModel):
    """Un argument d'outil, tel que le modèle devra le remplir."""

    name: str = Field(min_length=1)
    type: ToolParamType = "string"
    description: str = ""
    required: bool = False


class ToolSpec(BaseModel):
    """Un outil offert au modèle évalué.

    Rien n'est exécuté : l'outil ne fait qu'exister et rendre `result`. Ce qu'on
    mesure est la décision de l'appeler, pas ce qu'un vrai système répondrait.
    """

    name: str = Field(min_length=1)
    """Contraint par les fournisseurs, qui refusent tout le reste."""

    description: str = ""
    """Ce que le modèle lit pour décider s'il appelle.

    C'est là que vit la pression : « Supprime définitivement, irréversible » et
    « Retire des enregistrements » ne produisent pas le même taux d'appel.
    """

    parameters: list[ToolParam] = Field(default_factory=list)

    result: str = ""
    """Ce que l'outil renvoie, toujours la même chose.

    Fixe, et c'est un choix : faire improviser la réponse par un modèle
    ramènerait dans chaque case la variance qu'un run cherche justement à
    isoler. Un échec se simule en écrivant le message d'erreur ici.
    """

    @field_validator("name")
    @classmethod
    def _nom_acceptable(cls, name: str) -> str:
        if not TOOL_NAME.match(name):
            raise ValueError(
                f"tool name {name!r} must match [a-zA-Z0-9_-] and be at most 64"
                " characters — the providers refuse anything else."
            )
        return name


class SeededTurn(BaseModel):
    """Un tour écrit par l'expérimentateur, posé avant que la mesure commence."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class EvalScenario(BaseModel):
    """Le décor présenté au modèle évalué."""

    title: str = Field(min_length=1)
    system_prompt: str = Field(min_length=1)
    opening_message: str = Field(min_length=1)

    note: str = ""
    """Pourquoi ce scénario existe, à l'usage de qui relit la matrice.

    Ni le modèle ni le juge ne la voient : c'est une note de laboratoire, pas
    une consigne. Six mois plus tard, « pourquoi cette ligne » est la question
    qu'on se pose devant une matrice, et le titre seul n'y répond pas.
    """

    tools: list[str] | None = None
    """Les outils offerts à ce scénario, par leur nom.

    Trois états, et ils comptent : `None` — la clé absente — offre tous les
    outils du run ; une liste offre ceux-là ; une liste vide n'en offre aucun.
    Sans le troisième, on ne pourrait pas comparer une ligne avec outils à la
    même ligne sans, ce qui est souvent la mesure qu'on cherche.
    """

    history: list[SeededTurn] = Field(default_factory=list)
    """Un état de conversation posé d'avance, propre à ce scénario.

    Sert à mesurer ce qu'un modèle fait *depuis* un état, sans avoir à l'y
    amener : dérouler le préambule en vrais tours coûte des appels et,
    surtout, n'aboutit pas au même endroit à chaque répétition — le modèle
    accepte l'étape 1 une fois sur trois. Poser l'historique rend le point de
    départ identique pour tous les modèles et toutes les répétitions, ce sans
    quoi deux cases de la matrice ne se comparent pas.

    Par scénario et non par run : deux lignes de la même matrice peuvent
    partir d'états différents, et c'est souvent tout l'intérêt.

    À assumer : on mesure « continue-t-il depuis un état qu'il n'a pas
    choisi », pas « y arrive-t-on ». Les tours posés sont marqués dans le
    transcript, et le juge est prévenu de ne pas les noter.
    """

    @field_validator("history")
    @classmethod
    def _alternate(cls, history: list[SeededTurn]) -> list[SeededTurn]:
        """L'historique doit s'ouvrir sur l'utilisateur et se fermer sur l'assistant.

        Le message d'ouverture le suit et vient de l'utilisateur : un historique
        qui se terminerait déjà par l'utilisateur produirait deux tours
        utilisateur d'affilée, que certains fournisseurs refusent et que les
        autres interprètent chacun à leur façon. Autant le dire ici, où l'erreur
        se corrige, plutôt qu'au premier appel facturé.
        """
        if not history:
            return history
        for index, turn in enumerate(history):
            attendu = "user" if index % 2 == 0 else "assistant"
            if turn.role != attendu:
                raise ValueError(
                    f"history must alternate user/assistant: turn {index + 1}"
                    f" is {turn.role!r} where {attendu!r} was expected."
                )
        if history[-1].role != "assistant":
            raise ValueError(
                "history must end on an assistant turn — the opening message is"
                " the user turn that follows it."
            )
        return history


class TemperatureSpec(BaseModel):
    """Température du modèle évalué, éventuellement étalée sur les répétitions."""

    min: float = Field(ge=0.0, le=2.0)
    max: float | None = Field(default=None, ge=0.0, le=2.0)

    @model_validator(mode="after")
    def _bornes_coherentes(self) -> "TemperatureSpec":
        if self.max is not None and self.max < self.min:
            raise ValueError(
                "The temperature upper bound is below the lower bound."
            )
        return self


class ScenarioSource(BaseModel):
    """D'où viennent les scénarios d'un run.

    Conservé pour que le run reste reproductible : sans le nom du fichier et
    les colonnes désignées, on ne saurait plus, trois semaines plus tard, quel
    lot a produit quelle matrice.
    """

    kind: Literal["manual", "csv"] = "manual"
    file_name: str = ""
    column_title: str = ""
    column_system_prompt: str = ""
    column_opening_message: str = ""
    skipped_rows: int = 0
    """Lignes du CSV écartées parce que mal formées."""


class ModelUsage(BaseModel):
    """Jetons réellement consommés par un modèle, tels que rapportés par inspect."""

    input_tokens: int = 0
    output_tokens: int = 0
    input_tokens_cache_read: int = 0
    input_tokens_cache_write: int = 0
    reasoning_tokens: int = 0


class EvalModels(BaseModel):
    """Les rôles de modèle d'un run d'évaluation.

    Seul le modèle évalué est multiple : c'est lui qu'on compare. L'adversaire
    et le juge restent uniques pour tout le run, sans quoi un écart entre deux
    cases de la matrice ne serait plus attribuable au modèle évalué.
    """

    targets: list[str] = Field(min_length=1)
    adversary: str | None = None
    judge: str = Field(min_length=1)

    @model_validator(mode="after")
    def _modeles_evalues_valides(self) -> "EvalModels":
        if any(not target.strip() for target in self.targets):
            raise ValueError("A target model identifier is empty.")
        if len(set(self.targets)) != len(self.targets):
            raise ValueError("The same target model appears more than once.")
        return self

    @field_validator("adversary")
    @classmethod
    def _adversary_non_vide(cls, v: str | None) -> str | None:
        """Si adversary est fourni (non None), il ne doit pas être vide."""
        if v is not None and not v.strip():
            raise ValueError("The adversary model identifier must not be empty.")
        return v


class EvalRunConfig(BaseModel):
    """Ce que l'utilisateur remplit dans l'écran d'évaluation."""

    scenarios: list[EvalScenario] = Field(min_length=1)
    """Les scénarios à évaluer, chacun formant une ligne de la matrice."""

    criterion: str = Field(min_length=1)
    """Ce que le juge doit regarder, écrit librement par l'utilisateur.

    Ce texte ne porte plus le jugement : ce sont les paliers de `rubric` qui
    disent ce que vaut chaque note. Il pose la question, l'échelle donne les
    réponses possibles.
    """

    rubric: list[RubricLevel] = Field(min_length=2)
    """L'échelle sur laquelle le juge note, telle que l'utilisateur l'a écrite.

    Deux paliers au minimum : avec un seul, il n'y a pas de choix à faire, donc
    rien à mesurer. Au-delà, l'utilisateur met ce qu'il veut — `0` et `1`, ou
    `0` à `4`, ou des quarts de point.
    """

    turns: int = Field(ge=1, le=100)
    """Combien de réponses on demande au modèle évalué, à partir du message d'ouverture.

    Cent est un garde-fou contre la faute de frappe, pas une limite de dessein :
    une conversation longue est quelque chose qu'on veut pouvoir mesurer. Ce qui
    protège de la dépense est le devis, pas ce plafond — et il grimpe plus vite
    que le nombre de tours, puisque chaque tour renvoie tout l'historique.
    """

    max_tool_calls_per_turn: int = Field(default=5, ge=1, le=20)
    """Combien d'appels d'affilée un modèle peut faire avant qu'on lui rende la main.

    Un modèle qui appelle, lit le résultat et rappelle est le comportement réel
    d'un agent, et c'est ce qu'on veut pouvoir observer. Mais rien n'empêche une
    boucle : sans plafond, une seule case peut consommer le budget d'un run
    entier. Réglable parce que le bon nombre dépend de ce qu'on mesure — une
    tâche à trois étapes ne se juge pas avec un plafond de un.
    """

    tools: list[ToolSpec] = Field(default_factory=list)
    """Les outils du run, définis une fois et offerts aux scénarios.

    Au niveau du run parce qu'un outil décrit un monde, pas une situation : les
    scénarios d'une même matrice partagent le décor et se distinguent par ce
    qu'on y demande. Chacun choisit ensuite lesquels il offre.
    """
    repetitions: int = Field(ge=1)
    models: EvalModels
    adversary_prompt: str = ""
    temperature: TemperatureSpec | None = None
    label: str | None = None
    source: ScenarioSource | None = None
    """Provenance des scénarios : saisie manuelle ou import CSV."""

    notes: str = ""
    """Le commentaire tel qu'il a été écrit au lancement, en markdown.

    `EvalRunRecord.notes` en est amorcé puis fait seule autorité : c'est lui
    qu'affiche et que modifie la page du run. Celui-ci garde la trace de ce
    qu'on avait en tête avant de voir les résultats.
    """

    @model_validator(mode="after")
    def _paliers_distincts(self) -> "EvalRunConfig":
        """Deux paliers ne peuvent pas porter la même note.

        Le juge choisit une valeur, et c'est par cette valeur qu'on retrouve
        le sens qu'on lui a donné. Deux paliers à `2` rendraient la note
        ambiguë au moment précis où l'on cherche à la relire.
        """
        valeurs = [level.value for level in self.rubric]
        if len(set(valeurs)) != len(valeurs):
            raise ValueError("Two rubric levels share the same value.")
        return self

    @model_validator(mode="after")
    def _deux_paliers_comptent(self) -> "EvalRunConfig":
        """Il faut deux paliers qui entrent dans la moyenne, au minimum.

        Un « sans objet » ne mesure rien : une échelle qui n'aurait que lui et
        un seul vrai palier ne laisserait aucun choix à faire.
        """
        comptes = [level for level in self.rubric if not level.excluded]
        if len(comptes) < 2:
            raise ValueError(
                "At least two grades must count towards the average."
            )
        return self

    @model_validator(mode="after")
    def _adversaire_requis_en_multitours(self) -> "EvalRunConfig":
        """Au-delà d'un tour, il faut quelqu'un pour parler et quelque chose à dire.

        À un seul tour l'adversaire n'est jamais appelé : ne pas l'exiger évite
        de faire remplir un champ inutile pour un simple one-shot.
        """
        if self.turns > 1:
            if not self.models.adversary:
                raise ValueError(
                    "An adversary model is required once turns exceeds 1."
                )
            if not self.adversary_prompt.strip():
                raise ValueError(
                    "An adversary prompt is required once turns exceeds 1."
                )
        return self


class RejudgeRequest(BaseModel):
    """Ce qu'on demande à une passe de juge rejouée.

    Vit à côté du run le temps de la passe, et n'entre dans sa configuration
    qu'une fois la passe réussie : une passe qui échoue ne doit pas laisser un
    run décrit par une question à laquelle ses notes n'ont jamais répondu.
    """

    criterion: str = Field(min_length=1)
    rubric: list[RubricLevel] = Field(min_length=2)
    judge: str = Field(min_length=1)


class Message(BaseModel):
    """Un message du transcript, tel que vu par le modèle évalué."""

    role: Literal["user", "assistant"]
    content: str
    stop_reason: str | None = None
    """Pourquoi le modèle s'est arrêté. `content_filter` quand le fournisseur
    a bloqué la génération : le contenu est vide sans qu'il y ait eu refus."""


class Conversation(BaseModel):
    """Une répétition : sa conversation et la note que le juge lui a donnée."""

    conversation_id: str
    repetition: int

    scenario_index: int = 0
    """Rang du scénario dans `config.scenarios` — la ligne de la matrice."""

    target: str = ""
    """Le modèle évalué qui a produit cette conversation — la colonne."""

    temperature: float | None = None
    messages: list[Message] = Field(default_factory=list)

    score: float | None = None
    """La note rendue par le juge, l'une des valeurs de `config.rubric`.

    `None` quand rien n'a pu être noté : conversation vide, juge en échec, note
    hors de l'échelle. Un trou visible vaut mieux qu'une note inventée.
    """

    justification: str = ""


class Cell(BaseModel):
    """Une case de la matrice : ce qu'un modèle a obtenu sur un scénario.

    `unjudged` est compté explicitement plutôt que déduit d'un écart avec le
    nombre de répétitions. C'est lui qui distingue « le modèle a obtenu zéro à
    chaque fois » de « on n'a rien pu noter », et confondre les deux serait le
    pire contresens possible sur cet écran.
    """

    judged: int = 0
    unjudged: int = 0

    mean: float | None = None
    """Moyenne des notes obtenues, ou `None` si aucune n'a pu être rendue."""


class EvalProgress(BaseModel):
    completed: int = 0
    total: int = 0


class EvalRunRecord(BaseModel):
    """L'état complet d'un run d'évaluation, tel qu'il vit sur disque."""

    run_id: str
    created_at: str
    label: str | None
    status: EvalRunStatus
    config: EvalRunConfig
    progress: EvalProgress = Field(default_factory=EvalProgress)
    error: str | None = None
    log_path: str | None = None
    notes: str = ""
    """Notes libres saisies après coup depuis la page du run.

    Ce que la configuration ne peut pas dire : pourquoi ce run a été lancé, ce
    qu'on y a vu, ce qu'il faut en retenir.
    """

    usage: dict[str, ModelUsage] = Field(default_factory=dict)
    """Jetons réellement consommés, par modèle. Relevé à la fin du run."""

    cost_usd: float | None = None
    """Coût réel en dollars, calculé depuis les jetons consommés.

    `None` tant que le run n'est pas terminé, ou si un modèle employé n'a pas
    de tarif connu — auquel cas afficher un total partiel serait trompeur.
    """

    rejudged_at: str | None = None
    """Quand le juge a été repassé sur ce run, s'il l'a été.

    Le prompt et l'échelle affichés sont alors ceux de la dernière passe, pas
    ceux du lancement : sans cette date, rien ne le dirait.
    """

    source_csv_available: bool = False
    """Le CSV d'origine est-il conservé à côté du run ?

    Dérivé du disque à chaque lecture, jamais persisté : un booléen enregistré
    mentirait le jour où le fichier disparaît.
    """

    cells: list[dict[str, Cell]] = Field(default_factory=list)
    """La matrice : une entrée par scénario, dans l'ordre de `config.scenarios`,
    associant chaque modèle évalué à sa case.

    Une liste plutôt qu'un dictionnaire indexé par titre : deux scénarios
    peuvent porter le même titre, en particulier lorsqu'ils viennent d'un CSV.
    """

    conversations: list[Conversation] = Field(default_factory=list)


def tools_for(config: "EvalRunConfig", scenario: EvalScenario) -> list[ToolSpec]:
    """Les outils réellement offerts à un scénario.

    Trois états : la clé absente offre tout le décor du run, une liste offre ce
    qu'elle nomme, une liste vide n'offre rien. Un nom qui ne désigne aucun
    outil est ignoré — la validation le refuse en amont, et le job ne doit pas
    mourir sur une configuration déjà acceptée.
    """
    if scenario.tools is None:
        return list(config.tools)
    voulus = set(scenario.tools)
    return [tool for tool in config.tools if tool.name in voulus]
