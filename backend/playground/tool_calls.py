"""Reading the arguments of a tool call, when the call is the answer.

Several places here ask a model to answer by calling a tool rather than by
writing prose: a judge submits its grade, the world model reports what a served
tool returned. Nothing free-form is ever parsed. This module holds the one
function that reads such a call back.
"""

from collections.abc import Iterable
from typing import Any

from inspect_ai.model import ChatMessageAssistant, ModelOutput


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
