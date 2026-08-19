"""Modèles pydantic du moteur d'évaluation.

Séparés de `schemas.py`, qui décrit la génération de scénarios : les deux
phases ne partagent aucune structure, et les mélanger rendrait chaque fichier
plus difficile à tenir en tête.
"""

from typing import Literal

from pydantic import BaseModel, Field, model_validator

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
                "La borne haute de température est inférieure à la borne basse."
            )
        return self


class EvalModels(BaseModel):
    """Les trois rôles de modèle d'un run d'évaluation."""

    target: str
    adversary: str | None = None
    judge: str


class EvalRunConfig(BaseModel):
    """Ce que l'utilisateur remplit dans l'écran d'évaluation."""

    scenario: EvalScenario
    criterion: str = Field(min_length=1)
    turns: int = Field(ge=1, le=10)
    repetitions: int = Field(ge=1)
    models: EvalModels
    adversary_prompt: str = ""
    temperature: TemperatureSpec | None = None
    label: str | None = None

    @model_validator(mode="after")
    def _adversaire_requis_en_multitours(self) -> "EvalRunConfig":
        """Au-delà d'un tour, il faut quelqu'un pour parler et quelque chose à dire.

        À un seul tour l'adversaire n'est jamais appelé : ne pas l'exiger évite
        de faire remplir un champ inutile pour un simple one-shot.
        """
        if self.turns > 1:
            if not self.models.adversary:
                raise ValueError(
                    "Un modèle adversaire est requis dès que turns dépasse 1."
                )
            if not self.adversary_prompt.strip():
                raise ValueError(
                    "Un prompt d'adversaire est requis dès que turns dépasse 1."
                )
        return self


class Message(BaseModel):
    """Un message du transcript, tel que vu par le modèle évalué."""

    role: Literal["user", "assistant"]
    content: str


class Conversation(BaseModel):
    """Une répétition : sa conversation et son verdict."""

    conversation_id: str
    repetition: int
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
    tally: Tally = Field(default_factory=Tally)
    conversations: list[Conversation] = Field(default_factory=list)
