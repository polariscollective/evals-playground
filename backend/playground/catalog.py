"""Catalogue des providers et modèles proposés dans l'interface.

Le catalogue est volontairement en dur : il ne liste pas tout ce qu'un provider
expose, mais les quelques modèles qu'on veut proposer par défaut. `key_present`
permet à l'UI de griser un provider dont la clé manque, plutôt que de laisser le
run échouer à l'exécution.
"""

import os

from pydantic import BaseModel


class ModelOption(BaseModel):
    """Un modèle proposé dans un menu déroulant."""

    id: str
    """Identifiant inspect complet, préfixe provider compris."""

    label: str
    """Libellé affiché."""


class ProviderInfo(BaseModel):
    """Un provider et l'état courant de sa clé d'API."""

    id: str
    label: str
    env_vars: list[str]
    key_present: bool
    models: list[ModelOption]


_PROVIDERS: list[dict] = [
    {
        "id": "anthropic",
        "label": "Anthropic",
        "env_vars": ["ANTHROPIC_API_KEY"],
        "models": [
            {"id": "anthropic/claude-opus-5", "label": "Claude Opus 5"},
            {"id": "anthropic/claude-sonnet-5", "label": "Claude Sonnet 5"},
            {"id": "anthropic/claude-haiku-4-5", "label": "Claude Haiku 4.5"},
        ],
    },
    {
        "id": "openai",
        "label": "OpenAI",
        "env_vars": ["OPENAI_API_KEY"],
        "models": [
            {"id": "openai/gpt-5.6-sol", "label": "GPT-5.6 Sol"},
            {"id": "openai/gpt-5.6-terra", "label": "GPT-5.6 Terra"},
            {"id": "openai/gpt-5.6-luna", "label": "GPT-5.6 Luna"},
        ],
    },
    {
        "id": "grok",
        "label": "xAI (Grok)",
        # Le provider grok d'inspect accepte l'une ou l'autre variable.
        "env_vars": ["XAI_API_KEY", "GROK_API_KEY"],
        "models": [
            {"id": "grok/grok-4.6", "label": "Grok 4.6"},
            {"id": "grok/grok-4.5", "label": "Grok 4.5"},
            {"id": "grok/grok-4.3", "label": "Grok 4.3"},
        ],
    },
]


def catalog() -> list[ProviderInfo]:
    """Les providers, avec l'état courant de leurs clés d'API."""
    return [
        ProviderInfo(
            id=provider["id"],
            label=provider["label"],
            env_vars=provider["env_vars"],
            key_present=any(os.environ.get(var) for var in provider["env_vars"]),
            models=[ModelOption(**model) for model in provider["models"]],
        )
        for provider in _PROVIDERS
    ]


def known_model_ids() -> set[str]:
    """Les identifiants de modèle que l'UI propose."""
    return {model["id"] for provider in _PROVIDERS for model in provider["models"]}
