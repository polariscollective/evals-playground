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


# --- Juges multiples --------------------------------------------------------
#
# Trois tables en base, chacune son modèle : `Judge` la configuration d'un
# juge, `RunJudge` sa liaison à un run donné, `JudgeScore` ce qu'il a trouvé
# sur une conversation. Voir la migration
# `evals/supabase/migrations/20260906092100_create_judges_tables.sql` (dépôt
# polaris-supabase) et docs/superpowers/specs/2026-09-06-juges-multiples.md
# pour le détail du raisonnement — ce qui suit n'en est qu'un miroir typé.
#
# `JudgeSpec`, en bas de cette section, n'est pas un miroir de table : c'est
# ce qu'un run porte en configuration, avant qu'aucune ligne n'existe.

JudgeSystemType = Literal["ordinary", "awake"]
"""Le domaine exact de la colonne `system_type`, dans `judges` comme dans
`run_judges` — celui du CHECK `judges_system_type_check` en base.

`"ordinary"` est un sentinelle, pas un type système : il ne désigne aucun
juge système, il dit seulement qu'il n'y en a pas. La colonne est NOT NULL
des deux côtés, sans valeur par défaut, depuis la migration
`20260906113533_run_judges_judge_fk_and_system_type_sentinel.sql` (dépôt
polaris-supabase) — avant elle, l'absence (`NULL`) jouait ce rôle, mais
désarmait au passage la clé étrangère composée de `run_judges` (voir
`RunJudge.system_type`). `"awake"`, le contrôle d'éveil, est le seul vrai
type système aujourd'hui. D'autres viendront sans nouvelle migration ; ils
s'ajoutent ici."""


class Judge(BaseModel):
    """Une ligne de `judges` : la configuration d'un juge, indépendante des
    runs qui l'utilisent — voir `RunJudge` pour la liaison à un run donné.

    Un juge ordinaire porte sa question et son échelle, écrites par
    l'utilisateur : `criterion` et `rubric` sont alors renseignés. Un juge
    système (`system_type` différent de `"ordinary"`) ne porte que son
    identité : sa question, son échelle et son prompt vivent dans le code,
    retrouvés par ce type — jamais en base. Les y mettre perdrait les trois garanties de git sur ce
    texte : le même partout, une relecture quand il change, un historique de
    qui l'a changé — et deux runs pourraient être notés par deux versions du
    texte sans que rien ne le dise.

    Ces deux formes s'excluent : `_ordinaire_ou_systeme` le fait respecter
    ici, comme la contrainte `judges_ordinary_or_system_check` le fait en
    base.
    """

    id: str
    criterion: str | None = None
    """La question posée au juge, telle que l'utilisateur l'a écrite. `None`
    pour un juge système — voir la docstring de la classe."""

    rubric: list[RubricLevel] | None = None
    """L'échelle du juge, telle que l'utilisateur l'a écrite. `None` pour un
    juge système — voir la docstring de la classe."""

    model: str
    """Le modèle qui juge."""

    system_type: JudgeSystemType
    """`"ordinary"` pour un juge ordinaire — sentinelle, jamais absent : la
    colonne est NOT NULL en base, sans valeur par défaut, donc ce champ n'a
    pas de valeur par défaut non plus ici ; toute construction d'un juge doit
    la poser explicitement. `"awake"` : le contrôle d'éveil — le modèle
    évalué a-t-il montré qu'il se savait testé ? Sa question n'appartient pas
    à l'utilisateur, son échelle est fixe de 1 à 10, et sa panne ne coûte
    jamais sa note au juge principal — ces trois propriétés vivent dans le
    code qui construit ce juge, pas ici."""

    created_by: str
    """Qui a créé ce juge — l'adresse de la session, jamais ce que le client
    prétend."""

    created_at: str

    @model_validator(mode="after")
    def _ordinaire_ou_systeme(self) -> "Judge":
        """Miroir de `judges_ordinary_or_system_check` : un juge système ne
        porte ni critère ni échelle ; un juge ordinaire porte les deux.

        « Ce juge est-il système ? » se lisait par une absence
        (`system_type is None`) ; depuis le sentinelle `"ordinary"`
        (migration `20260906113533`, dépôt polaris-supabase), elle se lit
        par une valeur : la comparaison doit rester `!= "ordinary"` /
        `== "ordinary"`, jamais `is not None` / `is None`. Ne jamais revenir
        à un test de nullité pour « simplifier » — `"ordinary"` n'est pas
        nul, un tel test serait toujours faux, et tous les juges
        deviendraient silencieusement des juges système.
        """
        porte_criterion = self.criterion is not None
        porte_rubric = self.rubric is not None
        if porte_criterion != porte_rubric:
            raise ValueError(
                "criterion and rubric must be both present or both absent."
            )
        if self.system_type != "ordinary" and porte_criterion:
            raise ValueError(
                "A system judge carries no criterion or rubric — its text"
                " lives in the code, retrieved by system_type."
            )
        if self.system_type == "ordinary" and not porte_criterion:
            raise ValueError(
                "An ordinary judge (system_type == 'ordinary') must carry a"
                " criterion and a rubric."
            )
        return self


class RunJudge(BaseModel):
    """Une ligne de `run_judges` : ce juge, dans ce run, à ce titre.

    La liaison existe avant la moindre conversation jugée — au lancement, ou
    le jour où on ajoute un juge à un run terminé. `is_principal` et
    `deleted_at` n'ont de sens que pour ce run : les poser sur `Judge` serait
    faux, puisque le même juge peut être principal ici et secondaire ailleurs.

    Le piège de ce dessin, et il est réel : le filtre « non supprimé »
    (`deleted_at is None`) doit vivre à un seul endroit, dans la fonction qui
    charge les juges d'un run. Le recopier dans deux lectures, c'est
    l'oublier dans une troisième — ce chantier a déjà produit deux exemples
    de cet oubli.
    """

    id: str
    run_id: str
    judge_id: str

    system_type: JudgeSystemType
    """Copie de `Judge.system_type` au moment de la liaison. `"ordinary"`
    pour une liaison ordinaire — sentinelle, jamais absent : NOT NULL en
    base des deux côtés, sans valeur par défaut, depuis la migration
    `20260906113533` (dépôt polaris-supabase) ; toute construction d'une
    liaison doit la poser explicitement, recopiée depuis le `Judge` visé,
    jamais écrite indépendamment de lui.

    Épinglée par la clé étrangère composée `(judge_id, system_type) ->
    judges (id, system_type)`, qui interdit toute divergence entre les deux
    copies — et, depuis la même migration, par une seconde clé étrangère
    portant sur `judge_id` seul, qui garantit à elle seule l'existence du
    juge visé : la composée ne le garantissait pas tant que `system_type`
    pouvait être `NULL` (`MATCH SIMPLE` la considère satisfaite dès qu'une
    colonne référençante est nulle, ce qui était le cas de la quasi-totalité
    des liaisons avant le sentinelle).

    N'existe ici que parce qu'un index unique partiel ne peut pas lire une
    colonne d'une autre table : l'invariant « au plus une liaison vivante
    d'un `system_type` donné (différent de `"ordinary"`) par run » porte sur
    cette table-ci, il lui faut donc sa propre colonne."""

    is_principal: bool = False
    """Le juge que la matrice affiche. Deux garanties distinctes, en base,
    composent l'« exactement une » que la conception vise pour tout run
    ayant au moins une liaison vivante — ni l'une ni l'autre ne le fait
    seule. L'index unique partiel `run_judges_single_principal_idx` ne
    garantit qu'**au plus une** liaison vivante principale par run ; il ne
    dit rien sur l'absence de principal. C'est le déclencheur différé
    `run_judges_require_principal_trg` (migration `20260906102248`) qui
    referme l'autre bord, et seulement pour les UPDATE qui retirent le
    principal à une liaison qui le portait déjà — un INSERT n'est jamais
    couvert, voir le commentaire de la migration pour ce trou de portée
    assumé."""

    deleted_at: str | None = None
    """`None` tant que la liaison est vivante. On supprime la liaison, jamais
    le juge : la ligne reste, marquée, pour qu'on sache encore que ce run a
    été jugé par celui-là, à un moment. La suppression est douce — un UPDATE
    qui pose cette colonne, jamais un DELETE : `judge_scores` porte bien une
    clé étrangère `on delete cascade` vers cette liaison, mais rien ne la
    déclenche jamais en pratique, et `service_role` n'a même pas le droit de
    supprimer une ligne de `run_judges` (seuls `select`, `insert`, `update`
    lui sont accordés — migration `20260906092100`). Les lignes de
    `JudgeScore` d'un juge délié restent donc en base, inchangées ; c'est la
    discipline de lecture — filtrer sur `deleted_at is null` avant de les
    lire — qui porte tout le poids de ne plus les montrer, pas une
    suppression qui n'a jamais lieu."""

    created_at: str


JudgeScoreStatus = Literal["pending", "done", "error"]
"""Les trois valeurs brutes que porte `JudgeScore.status` en base — le CHECK
`judge_scores_status_check`. Elles distinguent quatre situations, pas trois :
`pending` avant que le job ne s'en occupe ; `done` recouvre à la fois « noté »
(`score` renseigné) et « sans note » (conversation vide, ou note hors
échelle), départagés par la nullité de `JudgeScore.score` plutôt que par une
quatrième valeur de statut ; `error` si le juge est tombé, où `score` reste
toujours `None`. C'est la même distinction à trois que ce produit tient déjà
pour une case de la matrice, à laquelle s'ajoute l'attente : quatre
situations réelles, portées par trois valeurs de colonne plus la nullité de
`score`. Ne pas ajouter une quatrième valeur de statut pour « sans note » :
la migration n'en porte pas, et ce fichier suit la migration."""


class JudgeScore(BaseModel):
    """Une ligne de `judge_scores` : ce qu'un juge a trouvé sur une
    conversation.

    Une ligne par (liaison, conversation) — voir `run_judge_id` et
    `sample_id`, dont le couple est la clé primaire en base : un juge donne
    une note et une seule par conversation. C'est ce qui rend une reprise
    sans danger — elle réécrit la même ligne au lieu d'empiler des doublons.

    Toutes les lignes existent dès le lancement, en `pending` : le job les
    remplit, il ne les crée pas — exactement comme `eval_samples` le fait déjà
    pour la matrice elle-même, et pour la même raison la plus forte : cela
    rend « ce qui reste à juger » un statut à lire plutôt qu'un calcul
    refait à deux endroits, qui peuvent diverger.
    """

    run_judge_id: str
    sample_id: str

    run_id: str
    """Recopié de `RunJudge.run_id` et d'`EvalSample.run_id`. Une ligne
    connaît son run par deux chemins, sa liaison et sa conversation, et rien
    ne garantit tout seul qu'ils s'accordent — c'est l'invariant que ce champ
    protège. En base, deux clés étrangères composées forcent les trois
    valeurs à coïncider ; ce champ n'existe ici que pour porter cette même
    valeur, jamais à recalculer indépendamment des deux autres."""

    status: JudgeScoreStatus = "pending"

    score: float | None = None
    """La note rendue par ce juge, une des valeurs de l'échelle du juge
    (`Judge.rubric`). `None` quand rien n'a pu être noté — voir
    `JudgeScoreStatus`."""

    justification: str = ""

    error: str | None = None
    """Pourquoi ce juge n'a rien rendu sur cette conversation. Distinct d'un
    score absent : ici il est tombé (`status == "error"`) ; là, il a répondu
    mais n'a rien pu noter (`status == "done"`, `score` `None`)."""

    created_at: str


class JudgeSpec(BaseModel):
    """Un juge secondaire d'un run, en plus du principal — une entrée de
    `EvalRunConfig.judges`.

    Le juge principal reste décrit par les champs historiques du run :
    `EvalRunConfig.criterion`, `EvalRunConfig.rubric`, et `EvalModels.judge`
    — pour que chaque configuration déjà écrite continue de valider sans
    changement. C'est l'ancienne forme, et elle reste valide : voir
    `EvalRunConfig.judges`. Cette classe ne porte que ce qui s'ajoute : au
    lancement, chaque entrée devient un `Judge` et une `RunJudge` non
    principale, notant les mêmes conversations que le principal.

    Toujours un juge ordinaire, jamais système : le juge d'éveil est ajouté
    par le moteur lui-même depuis `EvalRunConfig.check_eval_awareness`,
    jamais écrit ici.
    """

    criterion: str = Field(min_length=1)
    rubric: list[RubricLevel] = Field(min_length=2)

    model: str | None = None
    """Le modèle qui juge, si différent de celui du run (`EvalModels.judge`).
    `None` reprend celui-ci : poser un juge de plus ne devrait pas obliger à
    répéter le même modèle quand c'est bien de lui qu'il s'agit."""

    @model_validator(mode="after")
    def _echelle_valide(self) -> "JudgeSpec":
        """Les mêmes deux règles que `EvalRunConfig` applique à sa propre
        échelle (voir `EvalRunConfig._paliers_distincts` et
        `EvalRunConfig._deux_paliers_comptent`) : deux paliers ne peuvent pas
        porter la même note, et il en faut deux au moins qui comptent dans la
        moyenne. Dupliquée plutôt que partagée pour ne pas faire dépendre ce
        petit modèle de configuration de la classe qui l'englobe.
        """
        valeurs = [level.value for level in self.rubric]
        if len(set(valeurs)) != len(valeurs):
            raise ValueError("Two rubric levels share the same value.")
        comptes = [level for level in self.rubric if not level.excluded]
        if len(comptes) < 2:
            raise ValueError(
                "At least two grades must count towards the average."
            )
        return self


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
    """Ce que l'outil renvoie, toujours la même chose — la forme **fixe**.

    Fixe, et c'est un choix : faire improviser la réponse par un modèle
    ramènerait dans chaque case la variance qu'un run cherche justement à
    isoler. Un échec se simule en écrivant le message d'erreur ici.

    Reste la bonne forme pour la plupart des outils, et le défaut. Elle ne
    tient plus que lorsque la sortie ne dépend pas légitimement de l'entrée —
    voir `retrieval_rules` pour l'autre cas.
    """

    retrieval_rules: str = ""
    """Comment cet outil lit le monde du run — la forme **servie**.

    Sa présence est le discriminant, et le seul : renseigné, l'outil est servi
    par le modèle d'environnement depuis `EvalRunConfig.world` ; vide, l'outil
    rend `result` sans qu'aucun modèle ne soit appelé. Un booléen en plus
    (`served_by_world`) serait deux façons de dire la même chose, donc deux
    occasions de se contredire — et il laisserait exister un outil servi dont
    personne n'a écrit comment il lit le monde.

    On y écrit une interface, pas un résumé : combien de lignes au maximum,
    dans quel ordre, la forme d'une erreur, celle d'un résultat vide. Le nom
    dit le cas dominant sans le couvrir tout entier — « fais la
    multiplication », « renvoie 404 si l'id est inconnu » s'y écrivent aussi.
    """

    @property
    def served(self) -> bool:
        """L'outil passe-t-il par le modèle d'environnement ?

        Le discriminant vit ici et nulle part ailleurs. Le recopier sur chaque
        site d'appel, c'est l'oublier sur le troisième — la leçon que
        `deleted_at` a déjà coûtée à ce dépôt (voir `RunJudge`).

        **Détouré**, et son jumeau TypeScript (`served`, `web/lib/tools.ts`)
        l'est aussi : les deux doivent répondre pareil sur la même entrée,
        sans quoi une configuration passe à l'écran et se fait refuser au
        démarrage du job — après que le lancement a été payé. Un champ à
        moitié effacé dans un formulaire laisse des blancs, et des blancs ne
        sont pas des règles de lecture.
        """
        return bool(self.retrieval_rules.strip())

    @model_validator(mode="after")
    def _fixe_ou_servi(self) -> "ToolSpec":
        """Un outil ne peut pas être les deux à la fois.

        L'absence des deux reste licite, et décrit un outil fixe au résultat
        vide : on mesure la décision d'appeler, pas ce que l'outil rend, et le
        refuser ici casserait la relecture des runs déjà en base.
        """
        if self.result and self.retrieval_rules:
            raise ValueError(
                f"tool {self.name!r} carries both result and retrieval_rules:"
                " a tool is fixed or served from the world, never both."
            )
        return self

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

    world: str = ""
    """Ce que cette ligne de la matrice change au monde du run.

    N'est pas concaténé à l'aveugle : les deux textes arrivent au modèle
    d'environnement comme deux blocs nommés, celui du scénario déclaré
    prioritaire sur celui du run. C'est ce qui rend la négation possible — « le
    contrat n'est pas sur ce lecteur » devient une correction à appliquer, et
    non une contradiction à démêler.

    L'ajout reste la forme normale : dans le run ce que toutes les lignes
    partagent, ici ce qui fait la différence de celle-ci. Une ligne qui se
    décrit par ce qu'elle ajoute se relit six mois plus tard ; une ligne qui se
    décrit par ce qu'elle retire, beaucoup moins.
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

    world: str | None = None
    """Le modèle qui sert les outils portant des règles de lecture.

    Requis exactement quand un outil du run est servi, et interdit sinon —
    voir `configProblem`. Pas de défaut : c'est un modèle qu'on paie à chaque
    appel servi, et un défaut que personne n'a remarqué se découvrirait sur
    une facture. Il était écrit en dur avant ce chantier ; ce qui a motivé le
    changement, et ce qui reste protégé, sont dans le spec du 7 septembre.
    """

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

    judges: list[JudgeSpec] = Field(default_factory=list)
    """Les juges secondaires du run, en plus du principal décrit par
    `criterion`, `rubric` et `models.judge` ci-dessus.

    Vide par défaut : une configuration qui ne porte que `criterion` et
    `rubric` — l'ancienne forme, celle de tous les fichiers déjà écrits —
    reste valide et décrit un run à un seul juge, le principal. Ajouter des
    entrées ici est ce qui permet à un agent de poser plusieurs juges d'un
    coup : au lancement, chacune devient un `Judge` et une `RunJudge` non
    principale, deux colonnes de notes sur la même matrice plutôt que deux
    runs qui ne joueraient pas les mêmes conversations et ne se
    compareraient donc pas.
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

    check_eval_awareness: bool = True
    """Un second juge relit-il chaque conversation pour dire si le modèle
    évalué s'est su testé ?

    Actif par défaut, parce que son intérêt est précisément de tourner sur les
    runs où personne n'a pensé à le demander : une matrice dont tous les modèles
    ont flairé le décor ne mesure plus le comportement des modèles, et rien
    d'autre ne le signale.

    On l'éteint quand la question n'a pas de sens — un scénario qui annonce lui
    -même qu'il teste quelque chose, par exemple. Il coûte un appel de juge par
    conversation.

    Vrai par défaut y compris pour les runs enregistrés avant ce champ : ils
    n'ont pas de note d'éveil, et c'est leur absence en base qui le dit, pas
    cette valeur.
    """

    world: str = ""
    """Ce que contient l'environnement, écrit par l'expérimentateur.

    Un bloc de texte libre, et il doit le rester : le jour où quelqu'un veut
    simuler une base, une boîte mail ou un système de tickets, il l'écrit comme
    il l'écrirait à un collègue. Imposer un schéma reviendrait à décider
    d'avance quels environnements ont le droit d'exister. Il porte aussi bien
    des données que des règles — « id inconnu, renvoie 404 ».

    Au niveau du run parce que les outils doivent s'accorder entre eux :
    `search_files` et `read_file` racontent le même lecteur partagé, et deux
    copies divergeraient. C'est déjà la raison pour laquelle `tools` vit ici.

    Vide sur les runs enregistrés avant ce champ, et vide sur tout run dont
    aucun outil n'est servi — auquel cas personne ne le lit, ce qui n'est pas
    une erreur.
    """

    tools: list[ToolSpec] = Field(default_factory=list)
    """Les outils du run, définis une fois et offerts aux scénarios.

    Au niveau du run parce qu'un outil décrit un monde, pas une situation : les
    scénarios d'une même matrice partagent le décor et se distinguent par ce
    qu'on y demande. Chacun choisit ensuite lesquels il offre.
    """

    average_output_tokens: int | None = Field(default=None, ge=1, le=100_000)
    """Jetons de sortie que consomme une réponse du modèle évalué, en gros.

    Ne sert qu'au devis : ce nombre ne change rien à ce que le run fait. Il
    compte tout ce que le modèle produit à chaque appel, raisonnement compris —
    c'est l'unité facturée, et `actual_cost` ne facture que `output_tokens`
    précisément parce que le raisonnement y est déjà.

    `None` pour les runs enregistrés avant ce champ : le devis retombe alors
    sur `DEFAULT_RESPONSE_TOKENS`.
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

    @model_validator(mode="after")
    def _monde_et_service_equivalents(self) -> "EvalRunConfig":
        """L'équivalence, dans les deux sens.

        Servir sans modèle ne répondrait à rien ; nommer un modèle sans rien
        à servir est un réglage sans effet, et un réglage sans effet est pire
        qu'absent — on le relit plus tard en se demandant s'il a compté.
        Miroir du refus TypeScript dans `configProblem`, voir
        `web/lib/validate.ts`.
        """
        sert = any(tool.served for tool in self.tools)
        monde = bool(self.models.world and self.models.world.strip())
        if sert and not monde:
            raise ValueError(
                "models.world: this run serves at least one tool, so it needs a "
                "model to answer those calls. Pick one from the models listed "
                "in /prompt."
            )
        if not sert and monde:
            raise ValueError(
                "models.world: no tool in this run has retrieval_rules, so "
                "nothing is served and this model would never be called. "
                "Remove it, or give a tool reading rules."
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
