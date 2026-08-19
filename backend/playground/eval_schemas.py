"""Modèles pydantic du moteur d'évaluation.

Séparés de `schemas.py`, qui décrit la génération de scénarios : les deux
phases ne partagent aucune structure, et les mélanger rendrait chaque fichier
plus difficile à tenir en tête.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

Verdict = Literal["met", "not_met", "borderline"]
"""Verdict du juge sur une conversation.

`met` : le critère d'échec est rempli, le modèle a fait la chose.
`not_met` : il ne l'est pas, le modèle a tenu.
`borderline` : cas limite, à regarder à l'œil.
"""

EvalRunStatus = Literal["pending", "running", "done", "error", "cancelled"]


class EvalScenario(BaseModel):
    """Le décor présenté au modèle évalué."""

    title: str = Field(min_length=1)
    system_prompt: str = Field(min_length=1)
    opening_message: str = Field(min_length=1)


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
    turns: int = Field(ge=1, le=10)
    repetitions: int = Field(ge=1)
    models: EvalModels
    adversary_prompt: str = ""
    temperature: TemperatureSpec | None = None
    label: str | None = None
    source: ScenarioSource | None = None
    """Provenance des scénarios : saisie manuelle ou import CSV."""

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


class Message(BaseModel):
    """Un message du transcript, tel que vu par le modèle évalué."""

    role: Literal["user", "assistant"]
    content: str
    stop_reason: str | None = None
    """Pourquoi le modèle s'est arrêté. `content_filter` quand le fournisseur
    a bloqué la génération : le contenu est vide sans qu'il y ait eu refus."""


class Conversation(BaseModel):
    """Une répétition : sa conversation et son verdict."""

    conversation_id: str
    repetition: int

    scenario_index: int = 0
    """Rang du scénario dans `config.scenarios` — la ligne de la matrice."""

    target: str = ""
    """Le modèle évalué qui a produit cette conversation — la colonne."""

    temperature: float | None = None
    messages: list[Message] = Field(default_factory=list)
    verdict: Verdict | None = None
    justification: str = ""


class Tally(BaseModel):
    """Décompte des verdicts sur l'ensemble des répétitions.

    Une répétition dont le jugement a échoué n'entre dans aucune case : l'écart
    entre la somme et le nombre de répétitions signale de lui-même l'incident.
    """

    met: int = 0
    not_met: int = 0
    borderline: int = 0


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

    tallies: list[dict[str, Tally]] = Field(default_factory=list)
    """La matrice des décomptes : une entrée par scénario, dans l'ordre de
    `config.scenarios`, associant chaque modèle évalué à son décompte.

    Une liste plutôt qu'un dictionnaire indexé par titre : deux scénarios
    peuvent porter le même titre, en particulier lorsqu'ils viennent d'un CSV.
    """

    conversations: list[Conversation] = Field(default_factory=list)
