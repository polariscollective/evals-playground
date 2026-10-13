"""Reading the arguments of a tool call, when the call is the answer.

Several places here ask a model to answer by calling a tool rather than by
writing prose: a judge submits its grade, the world model reports what a served
tool returned. Nothing free-form is ever parsed. This module holds the one
function that reads such a call back.
"""

from collections.abc import Iterable, Sequence
from typing import Any

from inspect_ai.model import (
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageTool,
    ChatMessageUser,
    Model,
    ModelOutput,
)
from inspect_ai.tool import Tool, ToolFunction

from playground.shared_data import load


def tool_call_arguments(
    output: ModelOutput, function_name: str, required: Iterable[str] = ()
) -> dict[str, Any]:
    """Arguments of the tool call expected in a model's answer.

    Takes the `ModelOutput` directly rather than a `TaskState`. Callers sit on
    both sides of that fence: `judges_scorer` (`scoring.py`) is a scorer and
    must never write to `state.output`, which is the field persisted as the
    sample's output in the log, while `world.py` reads an answer it has just
    generated itself and holds no task state at all. Asking for the output is
    the only thing they have in common.

    Args:
        output: The model answer whose tool call is to be read.
        function_name: Name of the tool whose arguments are wanted.
        required: Keys that must be present in the returned arguments. Empty by
            default: no shape validation.

    Raises:
        ValueError: if the model did not call the tool, despite `tool_choice`,
            or if keys named in `required` are missing from the arguments.
    """
    message = output.message
    if isinstance(message, ChatMessageAssistant):
        for call in message.tool_calls or []:
            if call.function == function_name:
                missing = [key for key in required if key not in call.arguments]
                if missing:
                    raise ValueError(
                        f"The call to tool {function_name!r} is missing "
                        f"the expected keys: {', '.join(missing)}."
                    )
                return call.arguments
    raise ValueError(
        f"The model did not call {function_name!r}: "
        f"{output.completion[:200]!r}"
    )


FREE_ATTEMPTS = 3
"""How many times a model left free to call the tool is asked, in all."""

NUDGE = "Answer by calling {name} now. Do not answer in text."
"""What a model left free hears after an answer that was not the call."""


def accepts_forced_tool(name: str) -> bool:
    """Whether `name` can be made to call one named tool.

    Claude Fable 5.1, Opus 5.5 and Sonnet 5.5 answer a forced tool choice with
    a 400, so the catalogue marks them `accepts_forced_tool: false`. A model
    outside the catalogue (the tests' `mockllm`) is assumed to accept it.
    """
    for provider in load("pricing")["providers"]:
        for model in provider["models"]:
            if model["id"] == name:
                return bool(model.get("accepts_forced_tool", True))
    return True


async def answer_by_tool(
    model: Model,
    input: Sequence[ChatMessage],
    tool: Tool,
    function_name: str,
    required: Iterable[str] = (),
    forced: bool | None = None,
) -> dict[str, Any]:
    """Has `model` answer by calling `tool`, and returns the call's arguments.

    A model that accepts it is forced to call the tool, once, as before. One
    that refuses forcing is offered the tool freely, and an answer that is not
    a valid call earns another request, up to `FREE_ATTEMPTS` in all. The
    history only grows between attempts: a rejected call gets its tool result
    (a provider refuses a call left unanswered), then the request is repeated.

    `forced` overrides what the catalogue says, for the tests.

    Raises:
        ValueError: as `tool_call_arguments` does, once the attempts are spent.
    """
    required = tuple(required)
    if forced is None:
        forced = accepts_forced_tool(str(model))
    if forced:
        output = await model.generate(
            input=list(input), tools=[tool], tool_choice=ToolFunction(name=function_name)
        )
        return tool_call_arguments(output, function_name, required)

    messages = list(input)
    for attempt in range(FREE_ATTEMPTS):
        output = await model.generate(input=messages, tools=[tool], tool_choice="auto")
        try:
            return tool_call_arguments(output, function_name, required)
        except ValueError as reason:
            if attempt == FREE_ATTEMPTS - 1:
                raise
            answered = [
                ChatMessageTool(
                    content=f"Not accepted: {reason}",
                    tool_call_id=call.id,
                    function=call.function,
                )
                for call in output.message.tool_calls or []
            ]
            messages = [
                *messages,
                output.message,
                *answered,
                ChatMessageUser(content=NUDGE.format(name=function_name)),
            ]
    raise AssertionError("unreachable")
