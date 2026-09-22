"""Building a model, with the route its catalogue entry imposes.

Only the models reached through OpenRouter carry a route. OpenRouter serves each
of them from many hosts, at different prices and precisions, and by default
picks one per call; a matrix then compares whichever builds answered, not the
model. `openrouter_host` in `shared/pricing.json` names the one host each model
is held to, and `allow_fallbacks: False` makes an unavailable host fail the call
loudly rather than hand it to another. The price in the same file is that
host's, which is what makes `actual_cost` exact for these models.

Every model the job builds goes through `routed_model`: a call site that went
back to `get_model` would silently lose the route, and nothing would say so
except a matrix answered by the wrong build.
"""

from typing import Any

from inspect_ai.model import Model, get_model

from playground.shared_data import load

ROUTES: dict[str, dict[str, Any]] = {
    model["id"]: {
        "provider": {"only": [model["openrouter_host"]], "allow_fallbacks": False}
    }
    for provider in load("pricing")["providers"]
    for model in provider["models"]
    if model.get("openrouter_host")
}
"""The construction arguments each routed model receives, by identifier."""


def route(name: str) -> dict[str, Any]:
    """The construction arguments `name` requires, empty for a direct model."""
    return ROUTES.get(name, {})


def routed_model(name: str, model_args: dict[str, Any] | None = None) -> Model:
    """`get_model(name)`, held to the route its catalogue entry names.

    `model_args` are passed on as they are: the tests thread `mockllm`'s
    through here, for the reason `conversation_solver.model_args` gives.
    """
    return get_model(name, **route(name), **(model_args or {}))
