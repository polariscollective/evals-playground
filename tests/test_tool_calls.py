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
