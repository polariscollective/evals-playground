"""Building a model, with the route its catalogue entry imposes.

Only the models reached through OpenRouter carry a route. OpenRouter serves each
of them from many hosts, at different prices and precisions, and by default
picks any of them per call; a matrix then compares whichever builds answered,
not the model. `openrouter_hosts` in `shared/pricing.json` names the hosts each
model is held to, each one checked against the catalogue's entry rule, and sent
as an `order` with `allow_fallbacks: False`: the first, then the second when the
first is saturated, and never a third. With every listed host down, the call
fails loudly rather than reach one nobody checked. The price in the same file is
the highest of the listed hosts', so `actual_cost` never falls short of the bill.

Every model the job builds goes through `routed_model`: a call site that went
back to `get_model` would silently lose the route, and nothing would say so
except a matrix answered by the wrong build.
"""

from typing import Any

from inspect_ai.model import Model, get_model

from playground.shared_data import load

ROUTES: dict[str, dict[str, Any]] = {
    model["id"]: {
        "provider": {"order": model["openrouter_hosts"], "allow_fallbacks": False}
    }
    for provider in load("pricing")["providers"]
    for model in provider["models"]
    if model.get("openrouter_hosts")
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
