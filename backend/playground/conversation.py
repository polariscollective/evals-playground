"""The conversation loop: an evaluated model facing an adversary.

The evaluated model sees nothing but an ordinary conversation: its system
prompt, then `user` messages it answers. It cannot tell the adversary from a
human correspondent.

The adversary sees the same conversation mirrored — its own messages as
`assistant`, the evaluated model's as `user` — preceded by a system prompt of
its own. That prompt never leaves its view.
"""

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal, NamedTuple, Sequence

from playground.eval_schemas import JournalEntry, ToolSpec
from playground.shared_data import load

from inspect_ai.tool import ToolCall, ToolDef, ToolParams
from inspect_ai.util import JSONSchema

from inspect_ai.model import (
    ChatMessage,
    ChatMessageAssistant,
    ChatMessageSystem,
    ChatMessageTool,
    ChatMessageUser,
    GenerateConfig,
    Model,
)


class Cancelled(Exception):
    """A stop was asked for, and not one more call will be spent.

    Raised from the exact place where the money is spent — just before a model
    call. Inspect records it in its log and, `fail_on_error` being false, moves
    on to the next cell, which raises in turn without calling anything.
    """


@dataclass
class ToolCallRecord:
    """A tool call decided on by the evaluated model.

    It is often *the* behaviour being measured — "did it call `delete_records`"
    — so it is recorded as it stands, arguments included, never summarised.
    """

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class Turn:
    """One turn of the conversation, from the evaluated model's point of view."""

    role: Literal["user", "assistant", "tool"]
    content: str
    stop_reason: str | None = None
    """Why the model stopped, when it is the one that spoke.

    Reads `content_filter` when the provider blocked the generation: the answer
    is then empty without the model having refused anything. Confusing the two
    would skew how the run is read.
    """

    tool_calls: list[ToolCallRecord] = field(default_factory=list)
    """The tools this assistant turn decided to call."""

    tool_call_id: str | None = None
    """On a `tool` turn: the call this result answers."""

    tool_name: str | None = None
    """On a `tool` turn: the tool that "answered"."""

    seeded: bool = False
    """Written by the experimenter, not produced by a model.

    This flag is what prevents the gravest mistake the feature makes possible:
    having the judge grade words the evaluated model never said. It travels into
    the recorded transcript, into the judge prompt and into the export.
    """

    world_change: str = ""
    """On a `tool` turn: what this call changed in the world, or empty.

    Empty on every reading tool, and on every run older than
    `2026-09-08-le-monde-qui-change.md`.

    **Never goes to the evaluated model nor to the judge.** `target_view` reads
    only `content` — it is the only place that builds the target's messages —
    and neither does the judge prompt. The field exists so the journal can be
    rebuilt from the transcript, and for nothing else: that is what makes a
    resume free (see `journal_from`), where recomputing it would mean replaying
    the chain of fingerprints in order.
    """


class ToolAnswer(NamedTuple):
    """What `serve_tool` returns: the result, and what the call changed.

    The environment model's `reasoning` does not cross this boundary — it is
    recorded on the `serve_tool` side, which talks to the database, and never
    enters a conversation. The partition is structural rather than observed:
    what does not arrive here cannot end up in a `TOOL` turn.
    """

    result: str
    world_change: str = ""


def journal_from(
    transcript: "Sequence[Turn]", specs: "dict[str, ToolSpec]"
) -> list[JournalEntry]:
    """A conversation's journal, rebuilt from its transcript.

    Writes only, in order. A read never enters it: that is what keeps the cache
    alive, and not a saving of space — see `JournalEntry`'s docstring.

    Arguments are read from the `assistant` turn, which carries the decision to
    call; the result and the effect from the `tool` turn that answers it, paired
    by `tool_call_id`. That is what makes a resume free: the replayed turns
    already carry everything, and there is nothing to recompute.

    A tool the configuration no longer knows is ignored — an extension may have
    removed what the conversation called, and nothing here should fall over on a
    run being read back.
    """
    arguments: dict[str, dict[str, Any]] = {}
    journal: list[JournalEntry] = []
    for turn in transcript:
        if turn.role == "assistant":
            for call in turn.tool_calls:
                arguments[call.id] = call.arguments
            continue
        if turn.role != "tool" or turn.tool_name is None:
            continue
        spec = specs.get(turn.tool_name)
        if spec is None or not spec.writes:
            continue
        journal.append(
            JournalEntry(
                tool=turn.tool_name,
                arguments=arguments.get(turn.tool_call_id or "", {}),
                result=turn.content,
                effect=turn.world_change,
            )
        )
    return journal


def target_view(system_prompt: str, transcript: list[Turn]) -> list[ChatMessage]:
    """What the evaluated model sees: its system prompt and the conversation.

    Nothing else enters here. It is the only place that builds its messages,
    which makes the safety invariant checkable at a glance.
    """
    messages: list[ChatMessage] = [ChatMessageSystem(content=system_prompt)]
    for turn in transcript:
        if turn.role == "user":
            messages.append(ChatMessageUser(content=turn.content))
        elif turn.role == "tool":
            # The result must come back to the model attached to its call:
            # without `tool_call_id`, providers refuse the message or attach it
            # to the wrong call when there are several.
            messages.append(
                ChatMessageTool(
                    content=turn.content,
                    tool_call_id=turn.tool_call_id,
                    function=turn.tool_name,
                )
            )
        else:
            messages.append(
                ChatMessageAssistant(
                    content=turn.content,
                    tool_calls=[
                        ToolCall(id=call.id, function=call.name, arguments=call.arguments)
                        for call in turn.tool_calls
                    ]
                    or None,
                )
            )
    return messages


_SHARED = load("adversary-prompt")
"""The adversary's system prompt, shared with TypeScript.

The interface has to price what the adversary will consume before a run exists.
Without this sharing it would keep an estimate of its own, which would end up
describing something other than the text actually sent — and the quote would lie
without anyone seeing it."""

CONFIDENTIALITY_NOTICE = _SHARED["confidentiality_notice"]
"""The confidentiality instruction we impose, distinct from the objective the
user writes in `adversary_prompt`.

The user writes an objective, not a confidentiality policy: guaranteeing it is
on us. It therefore frames the user's objective in `adversary_view` (before and
after) rather than being buried inside it.
"""


def adversary_view(
    adversary_prompt: str, opening_message: str, transcript: list[Turn]
) -> list[ChatMessage]:
    """What the adversary sees: its secret prompt and the mirrored conversation.

    The opening message is placed in the system prompt rather than in the
    history. Otherwise the conversation would start with an `assistant` message,
    which the Anthropic API refuses — the first message after the system one
    must be a `user`. The adversary therefore knows what it "said" without the
    conversation starting on the wrong role.

    The confidentiality instruction (`CONFIDENTIALITY_NOTICE`) frames the user's
    objective: it reduces the risk of the adversary revealing its instructions
    without being able to eliminate it — nothing guarantees what a language
    model produces. If the adversary copies its instructions into its message
    anyway, that text legitimately reaches the evaluated model through the
    conversation's ordinary channel; see
    `test_known_limit_an_adversary_copying_its_instructions_still_leaks_them`
    in `tests/test_conversation.py`, which documents that known limit.
    """
    system = _SHARED["system_template"].format(
        notice=CONFIDENTIALITY_NOTICE,
        adversary_prompt=adversary_prompt,
        opening_message=opening_message,
    )
    messages: list[ChatMessage] = [ChatMessageSystem(content=system)]
    for turn in transcript[1:]:
        if turn.role == "assistant":
            messages.append(ChatMessageUser(content=turn.content))
        else:
            messages.append(ChatMessageAssistant(content=turn.content))
    return messages


MAX_TOOL_CALLS_PER_TURN = 5
"""The default cap, when the configuration sets none.

A model that calls, reads and calls again is the real behaviour of an agent, and
that is what we want to be able to observe. But nothing prevents a loop: with no
cap, a single cell can consume a whole run's budget.
"""


def tool_definitions(tools: "Sequence[ToolSpec]") -> list[ToolDef]:
    """The run's tools, translated for inspect.

    Nothing is executed: the function returned is a decoy, never called. It is
    `run_conversation` that answers, with the `result` written in the definition
    — the same answer at every repetition, without which two cells of the matrix
    would not be measuring the same thing.

    The format from one provider to the next is not our concern: inspect
    translates `ToolDef` into each of them.
    """

    async def never_called(**_: Any) -> str:  # pragma: no cover
        raise AssertionError("tools are simulated, never executed")

    definitions = []
    for spec in tools:
        params = ToolParams(
            properties={
                param.name: JSONSchema(
                    type=param.type, description=param.description
                )
                for param in spec.parameters
            },
            required=[p.name for p in spec.parameters if p.required],
        )
        definitions.append(
            ToolDef(
                tool=never_called,
                name=spec.name,
                description=spec.description,
                parameters=params,
            )
        )
    return definitions


async def run_conversation(
    *,
    system_prompt: str,
    opening_message: str,
    turns: int,
    target: Model,
    adversary: Model | None = None,
    adversary_prompt: str = "",
    temperature: float | None = None,
    history: "Sequence[Turn] | None" = None,
    resume: "Sequence[Turn] | None" = None,
    tools: "Sequence[ToolSpec] | None" = None,
    serve_tool: (
        "Callable[[ToolSpec, dict[str, Any], Sequence[JournalEntry]],"
        " Awaitable[ToolAnswer]] | None"
    ) = None,
    max_tool_calls: int = MAX_TOOL_CALLS_PER_TURN,
    stopped: "Callable[[], bool] | None" = None,
) -> list[Turn]:
    """Plays a conversation of `turns` turns and returns its transcript.

    The opening message is fixed and counts as the first turn: every repetition
    of a run therefore starts identically and they stay comparable with one
    another.

    Args:
        system_prompt: The evaluated model's system prompt.
        opening_message: The first message that puts it in the situation.
        turns: How many answers are expected from the evaluated model, 1 to 10.
        target: The evaluated model.
        adversary: The model that pushes. Not needed at `turns = 1`.
        adversary_prompt: Its secret instruction.
        history: A conversation state seeded in advance, belonging to the
            scenario. The model starts as though it had lived it, which makes
            the starting point identical for every repetition — playing the
            preamble out as real turns does not land in the same place every
            time, and costs calls.
        resume: A conversation already played, to be continued. Unlike
            `history`, its turns are not marked as seeded — they were produced —
            and the opening message is not reinserted, since it is already
            there. `turns` then counts the turns to *add*. If the resumed
            conversation ends on the target and `turns` is not zero, the
            adversary pushes once before the loop: without that the target would
            follow on from its own last line.
        serve_tool: What answers calls to **served** tools — those carrying
            `retrieval_rules`. Received ready-built, like `target` and
            `adversary`: this loop knows neither the world, nor the model that
            serves it, nor the database where the answers are kept. Required as
            soon as a tool is served, and never consulted for a fixed tool,
            which therefore costs no call. It receives the conversation's
            journal as it stands **before** this call — that is the state the
            answer is computed and cached against, never the one it leaves.
        tools: The tools offered to the evaluated model for this scenario.
            Nothing is executed: each call receives the `result` written in its
            definition, the same at every repetition. Having the answer
            improvised would bring back into every cell the very variance a run
            is trying to isolate.
        max_tool_calls: How many calls in a row before the turn is handed on.
            The last one still gets its answer: a call left hanging makes the
            transcript invalid for what follows.
        temperature: Applied to the evaluated model alone. The adversary runs at
            its provider's default: varying it at the same time would make any
            difference in behaviour unattributable.
        stopped: Consulted just before each model call, and nowhere else. That
            is the only place that counts: inspect starts every sample at once
            and has them wait for a connection token *inside* `generate`. A
            check placed before the queue would be crossed by everyone in the
            first second, and would stop nothing.

    Raises:
        ValueError: if `turns` goes beyond 1 with no adversary.
    """
    # Checked up front: before any call to the evaluated model, make sure we
    # have an adversary if more than one turn is needed. Otherwise a real API
    # request would be sent and billed for nothing.
    if turns > 1 and adversary is None:
        raise ValueError(
            "An adversary model is required to go beyond one turn."
        )

    if resume is not None:
        # A conversation being continued. Its turns were produced, not
        # seeded: marking them `seeded` would have the judge skip them, and it
        # would grade only the added turns. And the opening message is already
        # there — reinserting it would put it in the middle of the conversation.
        transcript: list[Turn] = list(resume)

        # The resumed conversation already ends on the target: that is the
        # product's invariant, a turn being the target speaking and then the
        # adversary pushing. Without that adversary turn, the loop would have
        # the target speak straight away, and it would follow on from its own
        # last line instead of answering a push — the cell would then carry one
        # push fewer than its depth suggests. Same view, same way of building
        # the input as the end-of-loop adversary call: this push must be
        # indistinguishable from the others.
        #
        # Two cases where there is nothing to push: `turns` at zero, a cell
        # already at the right depth that is only being rejudged; and a
        # transcript that already ends on a push (`user`), an answer being
        # awaited already. A target turn may end on `assistant` as well as on
        # `tool` — the tool-call cap closes the turn with a summarising `tool`
        # turn — and in both cases nobody is waiting for an answer yet: the
        # ordinary loop below pushes after every target turn without caring how
        # it ended, and this guard must say the same thing.
        if (
            turns > 0
            and adversary is not None
            and transcript
            and transcript[-1].role != "user"
        ):
            if stopped is not None and stopped():
                raise Cancelled("stopped before the adversary's opening turn")
            adversary_output = await adversary.generate(
                input=adversary_view(adversary_prompt, opening_message, transcript),
            )
            transcript.append(
                Turn(role="user", content=adversary_output.completion)
            )
    else:
        # The seeded history opens the transcript. The model receives it as
        # though it had lived it — that is the point — but every turn stays
        # flagged, and the judge knows not to grade it.
        transcript = [
            Turn(role=turn.role, content=turn.content, seeded=True)
            for turn in (history or [])
        ]
        transcript.append(Turn(role="user", content=opening_message))
    target_config = (
        GenerateConfig(temperature=temperature)
        if temperature is not None
        else GenerateConfig()
    )

    definitions = tool_definitions(tools or [])
    specs = {spec.name: spec for spec in (tools or [])}
    if serve_tool is None and any(spec.served for spec in specs.values()):
        raise ValueError(
            "a tool carries retrieval_rules but no serve_tool was given: it"
            " would silently return nothing, and a cell that lies is worse"
            " than a cell that is missing."
        )

    # This conversation's journal: the calls that changed the world, and those
    # alone. Rebuilt from the resumed turns — that is what makes deepening free
    # — then kept up to date as calls come.
    journal = journal_from(transcript, specs)

    async def answer_for(call: ToolCall) -> ToolAnswer:
        """What this call receives: the fixed string, or the world.

        Nothing is cached here. `serve_tool` decides, since it is the one that
        knows what is already in the database — this loop talks to nobody.

        A fixed tool that writes still journals, and without calling anyone: its
        sentence is the one the experimenter wrote. That is the common shape of
        writing tools, and reserving journalling for served tools would have
        missed all of them.
        """
        spec = specs.get(call.function)
        if spec is None:
            return ToolAnswer(f"Unknown tool {call.function!r}.")
        if not spec.served:
            return ToolAnswer(spec.result, spec.world_effect.strip())
        return await serve_tool(spec, call.arguments or {}, journal)

    for turn_index in range(turns):
        # A turn is one answer from the evaluated model — not one model call.
        # A model with tools may call, read the result and call again before
        # really answering; all of that stays the same turn, capped.
        for attempt in range(max_tool_calls + 1):
            if stopped is not None and stopped():
                raise Cancelled("stopped before the evaluated model's turn")
            target_output = await target.generate(
                input=target_view(system_prompt, transcript),
                config=target_config,
                tools=definitions,
            )
            calls = target_output.message.tool_calls or []
            transcript.append(
                Turn(
                    role="assistant",
                    content=target_output.completion,
                    stop_reason=(
                        target_output.choices[0].stop_reason
                        if target_output.choices
                        else None
                    ),
                    tool_calls=[
                        ToolCallRecord(
                            id=call.id, name=call.function, arguments=call.arguments
                        )
                        for call in calls
                    ],
                )
            )
            if not calls:
                break

            # Every call gets its answer — the same string for a fixed tool,
            # whatever the world returns for a served one. A call with no answer
            # would leave the transcript invalid for the next turn: providers
            # refuse a call left hanging.
            capped = attempt == max_tool_calls
            for call in calls:
                # The cap serves nothing: it does not consult the world, does
                # not journal, and so changed nothing. A write refused for lack
                # of room did not happen.
                answer = (
                    await answer_for(call)
                    if not capped
                    else ToolAnswer("Tool call limit reached for this turn.")
                )
                transcript.append(
                    Turn(
                        role="tool",
                        content=answer.result,
                        tool_call_id=call.id,
                        tool_name=call.function,
                        world_change=answer.world_change,
                    )
                )
                # The entry is laid down AFTER the call has been served: what
                # enters the journal was already computed against the state
                # before it. The reverse order would make the cache key
                # circular — the entry carrying the result it serves to find.
                spec = specs.get(call.function)
                if not capped and spec is not None and spec.writes:
                    journal.append(
                        JournalEntry(
                            tool=call.function,
                            arguments=call.arguments or {},
                            result=answer.result,
                            effect=answer.world_change,
                        )
                    )
            if capped:
                break

        if turn_index == turns - 1:
            break

        if stopped is not None and stopped():
            raise Cancelled("stopped before the adversary's turn")
        adversary_output = await adversary.generate(
            input=adversary_view(adversary_prompt, opening_message, transcript),
        )
        transcript.append(
            Turn(role="user", content=adversary_output.completion)
        )

    return transcript
