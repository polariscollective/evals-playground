"""Catalogue des providers et modèles proposés dans l'interface.

Le catalogue est volontairement en dur : il ne liste pas tout ce qu'un provider
expose, mais les quelques modèles qu'on veut proposer par défaut. `key_present`
permet à l'UI de griser un provider dont la clé manque, plutôt que de laisser le
run échouer à l'exécution.
"""

import os

from pydantic import BaseModel

from playground.pricing import PRICES
from playground.shared_data import load


class ModelOption(BaseModel):
    """Un modèle proposé dans un menu déroulant."""

    id: str
    """Identifiant inspect complet, préfixe provider compris."""

    label: str
    """Libellé affiché."""

    input_per_mtok: float | None = None
    """Prix d'entrée en dollars par million de jetons, ou None si inconnu."""

    output_per_mtok: float | None = None
    """Prix de sortie en dollars par million de jetons, ou None si inconnu.

    Exposé à côté du prix d'entrée parce que c'est lui qui varie le plus d'un
    modèle à l'autre — d'un facteur vingt-cinq sur le catalogue actuel — et
    donc lui qui pèse le plus sur la facture d'un run.
    """


class ProviderInfo(BaseModel):
    """Un provider et l'état courant de sa clé d'API."""

    id: str
    label: str
    env_vars: list[str]
    key_present: bool
    models: list[ModelOption]


_PROVIDERS: list[dict] = load("pricing")["providers"]
"""Le catalogue, partagé avec TypeScript — voir `shared/pricing.json`.

Volontairement restreint : il ne liste pas tout ce qu'un fournisseur expose,
mais les quelques modèles qu'on veut proposer par défaut."""


def catalog() -> list[ProviderInfo]:
    """Les providers, avec l'état courant de leurs clés d'API."""
    return [
        ProviderInfo(
            id=provider["id"],
            label=provider["label"],
            env_vars=provider["env_vars"],
            key_present=any(os.environ.get(var) for var in provider["env_vars"]),
            models=[
                ModelOption(
                    **model,
                    input_per_mtok=(
                        PRICES[model["id"]].input_per_mtok
                        if model["id"] in PRICES
                        else None
                    ),
                    output_per_mtok=(
                        PRICES[model["id"]].output_per_mtok
                        if model["id"] in PRICES
                        else None
                    ),
                )
                for model in provider["models"]
            ],
        )
        for provider in _PROVIDERS
    ]


def known_model_ids() -> set[str]:
    """Les identifiants de modèle que l'UI propose."""
    return {model["id"] for provider in _PROVIDERS for model in provider["models"]}
