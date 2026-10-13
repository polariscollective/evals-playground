import pytest
from inspect_ai.model import ModelOutput

from playground.tool_calls import tool_call_arguments


def test_no_tool_call_at_all_raises_and_names_the_tool():
    output = ModelOutput.from_content(
        model="mockllm/model", content="Sorry, I cannot do that."
    )
    with pytest.raises(ValueError, match="submit_score"):
        tool_call_arguments(output, "submit_score")


def test_another_tool_than_the_one_asked_for_raises():
    output = ModelOutput.for_tool_call(
        model="mockllm/model", tool_name="other_tool", tool_arguments={"x": 1}
    )
    with pytest.raises(ValueError, match="submit_score"):
        tool_call_arguments(output, "submit_score")


def test_missing_keys_raise_an_error_that_names_them():
    output = ModelOutput.for_tool_call(
        model="mockllm/model",
        tool_name="submit_score",
        tool_arguments={"value": 3},
    )
    with pytest.raises(ValueError) as exc_info:
        tool_call_arguments(
            output, "submit_score", required=["value", "justification"]
        )
    assert "justification" in str(exc_info.value)
    assert "submit_score" in str(exc_info.value)


def test_without_required_no_key_is_validated():
    # Default behaviour: `required` is optional, and a caller may read a call
    # back without imposing any shape on it.
    output = ModelOutput.for_tool_call(
        model="mockllm/model", tool_name="a_tool", tool_arguments={"a": 1}
    )
    assert tool_call_arguments(output, "a_tool") == {"a": 1}


def test_required_is_generic_and_names_the_absent_key():
    # `required` carries no knowledge of any particular tool: each caller
    # passes the keys its own tool declares.
    output = ModelOutput.for_tool_call(
        model="mockllm/model", tool_name="a_tool", tool_arguments={"a": 1}
    )
    with pytest.raises(ValueError, match="b"):
        tool_call_arguments(output, "a_tool", required=["a", "b"])


# --- answering by a tool, forced or not -------------------------------------

import asyncio

from inspect_ai.model import ChatMessageUser, get_model
from inspect_ai.tool import ToolFunction, tool

from playground.tool_calls import FREE_ATTEMPTS, accepts_forced_tool, answer_by_tool


@tool
def submit_score():
    async def execute(score: int, justification: str = "") -> str:
        """Submit the grade.

        Args:
            score: The grade.
            justification: Why.
        """
        return "ok"

    return execute


def _scripted(outputs, seen):
    """A `custom_outputs` callable replaying `outputs` in order and recording
    the input and tool choice of every call."""
    queue = list(outputs)

    def output(input, tools, tool_choice, config):
        seen.append((list(input), tool_choice))
        return queue.pop(0)

    return output


def _call(score=1):
    return ModelOutput.for_tool_call(
        model="mockllm", tool_name="submit_score", tool_arguments={"score": score}
    )


def _text(content="I would give it a one."):
    return ModelOutput.from_content(model="mockllm", content=content)


def _answer(outputs, forced, seen):
    model = get_model("mockllm/model", custom_outputs=_scripted(outputs, seen))
    return asyncio.run(
        answer_by_tool(
            model,
            [ChatMessageUser(content="Grade this.")],
            submit_score(),
            "submit_score",
            required=("score",),
            forced=forced,
        )
    )


def test_a_model_that_accepts_it_is_forced_to_call_the_tool_once():
    seen = []
    assert _answer([_call(1)], forced=True, seen=seen) == {"score": 1}
    assert len(seen) == 1
    assert seen[0][1] == ToolFunction(name="submit_score")


def test_a_model_that_refuses_forcing_is_left_free_and_asked_again():
    # Claude Opus 5.5 and Sonnet 5.5 answer a forced tool choice with a 400:
    # the tool is offered freely, and a reply in text earns a second request.
    seen = []
    assert _answer([_text(), _call(0)], forced=False, seen=seen) == {"score": 0}
    assert [choice for _, choice in seen] == ["auto", "auto"]
    retry_input = seen[1][0]
    assert retry_input[-2].role == "assistant"
    assert "submit_score" in retry_input[-1].text
    assert retry_input[-1].role == "user"


def test_a_free_model_that_never_calls_the_tool_fails_after_its_attempts():
    seen = []
    with pytest.raises(ValueError, match="submit_score"):
        _answer([_text()] * FREE_ATTEMPTS, forced=False, seen=seen)
    assert len(seen) == FREE_ATTEMPTS


def test_a_free_call_missing_a_key_is_answered_before_asking_again():
    # The rejected call gets its tool result: a provider refuses a tool call
    # left unanswered in the history.
    seen = []
    bad = ModelOutput.for_tool_call(
        model="mockllm", tool_name="submit_score", tool_arguments={"justification": "x"}
    )
    assert _answer([bad, _call(1)], forced=False, seen=seen) == {"score": 1}
    retry_input = seen[1][0]
    assert [m.role for m in retry_input[-3:]] == ["assistant", "tool", "user"]


def test_the_catalogue_says_which_models_refuse_a_forced_tool():
    assert accepts_forced_tool("anthropic/claude-opus-5-5") is False
    assert accepts_forced_tool("anthropic/claude-sonnet-5-5") is False
    assert accepts_forced_tool("anthropic/claude-fable-5-1") is False
    assert accepts_forced_tool("anthropic/claude-haiku-5-5") is True
    assert accepts_forced_tool("anthropic/claude-haiku-4-5") is True
    # Outside the catalogue (the tests' mockllm), the forced path stands.
    assert accepts_forced_tool("mockllm/model") is True
