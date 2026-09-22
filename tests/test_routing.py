"""Models reached through OpenRouter, and the one host each is held to."""

import pytest

import playground.routing as routing
from playground.routing import ROUTES, route, routed_model
from playground.shared_data import load

CATALOGUE = [
    model for provider in load("pricing")["providers"] for model in provider["models"]
]


def test_every_model_reached_through_openrouter_names_its_host():
    # Without a host, OpenRouter picks one per call among fifteen to thirty,
    # at different prices and precisions: two repetitions of one cell could
    # then be answered by two different builds of the model.
    hostless = [
        model["id"]
        for model in CATALOGUE
        if model["id"].startswith("openrouter/") and not model.get("openrouter_host")
    ]
    assert hostless == []


def test_a_model_called_directly_names_no_host():
    # A host on a direct model would be read by nobody, and would suggest a
    # route that does not exist.
    stray = [
        model["id"]
        for model in CATALOGUE
        if not model["id"].startswith("openrouter/") and "openrouter_host" in model
    ]
    assert stray == []


def test_a_model_reached_through_openrouter_is_held_to_its_host_alone():
    assert route("openrouter/z-ai/glm-5.3") == {
        "provider": {"only": ["fireworks"], "allow_fallbacks": False}
    }


def test_deepseek_v3_2_is_held_to_novita():
    # The model ai-character-index seats; Fireworks does not serve it, and
    # Novita bills the price that index prices it at.
    assert route("openrouter/deepseek/deepseek-v3.2") == {
        "provider": {"only": ["novita"], "allow_fallbacks": False}
    }


def test_a_model_called_directly_receives_nothing():
    assert route("anthropic/claude-opus-5") == {}
    assert route("mockllm/model") == {}


def test_every_openrouter_model_of_the_catalogue_has_a_route():
    assert set(ROUTES) == {
        model["id"] for model in CATALOGUE if model["id"].startswith("openrouter/")
    }


@pytest.fixture
def built(monkeypatch):
    calls: list[tuple[str, dict]] = []

    def fake_get_model(name, **kwargs):
        calls.append((name, kwargs))
        return name

    monkeypatch.setattr(routing, "get_model", fake_get_model)
    return calls


def test_the_route_reaches_the_model_built(built):
    routed_model("openrouter/moonshotai/kimi-k3")
    assert built == [
        (
            "openrouter/moonshotai/kimi-k3",
            {"provider": {"only": ["moonshotai"], "allow_fallbacks": False}},
        )
    ]


def test_the_arguments_passed_in_travel_with_the_route(built):
    # The tests' `mockllm` arguments must keep arriving, and a route must not
    # swallow them.
    routed_model("openrouter/z-ai/glm-5.2", {"custom_outputs": ["x"]})
    assert built[0][1] == {
        "provider": {"only": ["fireworks"], "allow_fallbacks": False},
        "custom_outputs": ["x"],
    }


def test_a_direct_model_is_built_as_before(built):
    routed_model("mockllm/model", {"custom_outputs": ["x"]})
    assert built == [("mockllm/model", {"custom_outputs": ["x"]})]
