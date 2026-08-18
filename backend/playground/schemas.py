"""Modèles pydantic partagés entre l'API, le job et le stockage."""

from typing import Literal

from pydantic import BaseModel, Field

Direction = Literal["gte", "lte"]
"""Sens du seuil : `gte` = le score doit être supérieur ou égal, `lte` inférieur ou égal."""

RunStatus = Literal["pending", "running", "done", "error", "cancelled"]


class JudgeSelection(BaseModel):
    """Un juge retenu pour un run, avec son seuil."""

    name: str
    threshold: int = Field(ge=1, le=10)
    direction: Direction


class RunModels(BaseModel):
    """Les deux rôles de modèle d'un run."""

    generator: str
    judge: str


class RunConfig(BaseModel):
    """Ce que l'utilisateur remplit dans l'écran de création."""

    seed: str = Field(min_length=1)
    n_scenarios: int = Field(ge=1)
    judges: list[JudgeSelection] = Field(min_length=1)
    models: RunModels
    label: str | None = None
    vary_axes: bool = True


class Scenario(BaseModel):
    """Un scénario généré, noté."""

    scenario_id: str
    title: str
    system_prompt: str
    opening_message: str
    tests_for: str
    variation_axis: str | None = None
    judge_summary: str = ""
    judge_scores: dict[str, int] = Field(default_factory=dict)
    judge_justifications: dict[str, str] = Field(default_factory=dict)
    passes: dict[str, bool] = Field(default_factory=dict)
    passes_all: bool = False
    mean_margin: float = 0.0


class RunProgress(BaseModel):
    completed: int = 0
    total: int = 0


class RunRecord(BaseModel):
    """L'état complet d'un run, tel qu'il vit sur disque."""

    run_id: str
    created_at: str
    label: str | None
    status: RunStatus
    config: RunConfig
    progress: RunProgress = Field(default_factory=RunProgress)
    error: str | None = None
    log_path: str | None = None
    scenarios: list[Scenario] = Field(default_factory=list)
