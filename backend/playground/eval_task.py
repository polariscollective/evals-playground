"""The dataset and the solver of an evaluation run.

A repetition is an inspect sample, not an epoch. The native `epochs=N`
mechanism does repeat a sample, but generation config is per eval rather than
per epoch: every repetition would share one temperature. One sample per
repetition lets each carry its own.
"""

from typing import Any, Callable

from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.model import get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver

from playground.conversation import ToolCallRecord, Turn, run_conversation
from playground.eval_schemas import EvalRunConfig, tools_for


def pending_dataset(
    rows: list[dict[str, Any]], config: EvalRunConfig
) -> MemoryDataset:
    """One cell per row still to be done.

    The matrix is not rebuilt from the configuration: it is read from the
    database, where every cell already exists with its temperature. That is what
    lets a run be resumed — replaying its errors, adding scenarios or models to
    it — without redoing what is already graded, and therefore already paid for.

    The temperature comes from the row and is never recomputed: a run completed
    in two goes carries two spreads, and starting again from
    `config.repetitions` would rewrite the one the older cells have.

    `usage` travels too, like `turns_done` and `played`: it is through that same
    metadata that `batch_job.record` finds what a cell already carries, so as to
    add its new pass to it rather than erase it when the cell is deepened.
    `cost_usd` does not travel: it is always recomputed from `usage`, never read
    as given — a field that merely passes through with no reader only misleads.
    """
    samples = []
    for index, row in enumerate(rows):
        scenario_index = int(row["scenario_index"])
        scenario = config.scenarios[scenario_index]
        temperature = row.get("temperature")
        samples.append(
            Sample(
                id=index + 1,
                input=scenario.opening_message,
                metadata={
                    "scenario_index": scenario_index,
                    "target": row["target_model"],
                    "repetition": int(row["repetition"]),
                    # PostgREST may return a `numeric` as a string so as
                    # not to lose precision; the solver expects a float.
                    "temperature": None if temperature is None else float(temperature),
                    "turns_done": row.get("turns_done") or 0,
                    "played": row.get("messages") or [],
                    "usage": row.get("usage") or {},
                },
            )
        )
    return MemoryDataset(samples, name="matrix")


def _fill_tool_call_id(played: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fills in the `tool_call_id` of `tool` turns that do not carry one.

    This function exists because `tool_call_id` has only recently been
    persisted: conversations recorded before that carry none on their `tool`
    turns. Without it, `target_view` (`conversation.py`) cannot attach a result
    to its call — the providers refuse it — and the assistant turn before it
    would lose its call at the very next save. It will stop being useful, and
    can be deleted, once no conversation in the database was recorded before
    that persistence was added.

    The reconstruction is not approximate: `run_conversation` produces `tool`
    turns immediately after the `assistant` turn that decided their calls, and
    in the same order (see `conversation.py`, `tool_call_id=call.id`). The nth
    consecutive `tool` turn therefore takes the id of that assistant turn's nth
    call.
    """
    filled: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []
    rank = 0
    for turn in played:
        role = turn.get("role")
        if role == "assistant":
            calls = turn.get("tool_calls") or []
            rank = 0
        elif role == "tool":
            if not turn.get("tool_call_id") and rank < len(calls):
                turn = {**turn, "tool_call_id": calls[rank].get("id")}
            rank += 1
        filled.append(turn)
    return filled


@solver
def conversation_solver(
    config: EvalRunConfig,
    model_args: dict[str, Any] | None = None,
    stopped: Callable[[], bool] | None = None,
    started: Callable[[TaskState], None] | None = None,
    serve_tool: Callable[..., Any] | None = None,
) -> Solver:
    """Plays one full conversation for one repetition.

    Args:
        config: The run configuration, for the target and adversary models.
        serve_tool: What answers tools served from the world, received from the
            caller that holds the database — signature
            `(scenario_index, tool, arguments, journal)`. The scenario's rank is
            passed here rather than captured by the caller: the world differs
            per scenario, and one solver serves every cell of the run. The
            journal comes from the conversation loop, the only place that knows
            what THIS conversation has already written.
        stopped: Passed on to the conversation loop, which consults it before
            each model call. Checking it here would achieve nothing: inspect
            starts every sample at once, and they would all cross this point
            before a click could have happened.
        started: Called when the cell genuinely begins, once the first
            connection token is obtained. Without it, a cell in flight reads as
            "to do" and the progress lies.
        model_args: Construction arguments passed on to `get_model`. Here, and
            nowhere else, is written the reason for threading them explicitly:
            `get_model(name)` alone does not receive them, since `mockllm` is
            excluded from inspect's memoisation (custom outputs may be a
            stateful generator), and an explicit model name — as opposed to
            `get_model()` with no argument — never falls back on the
            evaluation's active model, the only one handed the `model_args`
            given to `eval()`.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        if started is not None:
            started(state)

        scenario = config.scenarios[int(state.metadata.get("scenario_index", 0))]
        target_name = state.metadata.get("target") or config.models.targets[0]
        adversary = (
            get_model(config.models.adversary, **(model_args or {}))
            if config.turns > 1 and config.models.adversary
            else None
        )
        # A cell that already carries a conversation is continued: only the
        # missing turns are asked for, and its transcript picks up where it
        # stopped. With no messages, it plays from scratch.
        played = state.metadata.get("played") or []
        done = int(state.metadata.get("turns_done") or 0)
        remaining = max(config.turns - done, 0) if played else config.turns
        transcript = await run_conversation(
            system_prompt=scenario.system_prompt,
            opening_message=scenario.opening_message,
            turns=remaining,
            target=get_model(target_name, **(model_args or {})),
            adversary=adversary,
            adversary_prompt=config.adversary_prompt,
            temperature=state.metadata.get("temperature"),
            history=[
                Turn(role=turn.role, content=turn.content)
                for turn in scenario.history
            ],
            resume=(
                [
                    Turn(
                        role=turn["role"],
                        content=turn["content"],
                        seeded=turn.get("seeded", False),
                        # Without which the judge, called on the whole
                        # transcript, would lose the trace of a block that
                        # happened before the resume (see `blocking_reason` in
                        # `scoring.py`) — and the next save would erase it for
                        # good.
                        stop_reason=turn.get("stop_reason"),
                        tool_name=turn.get("tool_name"),
                        tool_call_id=turn.get("tool_call_id"),
                        # Absent from conversations recorded before this
                        # field existed: their journal is then rebuilt with no
                        # declared effect, which is exactly what they lived.
                        world_change=turn.get("world_change") or "",
                        # Likewise absent before the blocks were stored, and
                        # absent for good on those rows: a signature cannot be
                        # invented after the fact. Such a conversation replays
                        # as it did before, which is what it lived too.
                        reasoning=turn.get("reasoning") or [],
                        tool_calls=[
                            ToolCallRecord(
                                id=call["id"],
                                name=call["name"],
                                arguments=call["arguments"],
                            )
                            for call in (turn.get("tool_calls") or [])
                        ],
                    )
                    for turn in _fill_tool_call_id(played)
                ]
                if played
                else None
            ),
            tools=tools_for(config, scenario),
            # The scenario's rank is closed over here, in the only place
            # that knows it: the conversation loop does not know which cell it
            # is playing, and has no need to learn it for this.
            serve_tool=(
                None
                if serve_tool is None
                else (
                    lambda tool, arguments, journal: serve_tool(
                        int(state.metadata.get("scenario_index", 0)),
                        tool,
                        arguments,
                        journal,
                    )
                )
            ),
            max_tool_calls=config.max_tool_calls_per_turn,
            stopped=stopped,
        )
        state.metadata["transcript"] = [
            {
                "role": turn.role,
                "content": turn.content,
                # The flag survives into the database: without it, reading
                # a run back six months later would no longer say which turns
                # were seeded.
                "seeded": turn.seeded,
                # The call is often *the* behaviour being measured: it is
                # recorded as it stands, arguments included, never summarised.
                "tool_calls": [
                    {"id": call.id, "name": call.name, "arguments": call.arguments}
                    for call in turn.tool_calls
                ],
                "tool_name": turn.tool_name,
                # On a `tool` turn, the call this result answers. Only
                # recently persisted: conversations recorded before do not
                # carry it, hence `_fill_tool_call_id` above.
                "tool_call_id": turn.tool_call_id,
                # On the `tool` turn of a writing tool: what that call
                # changed in the world. It survives in the database because
                # that is where the journal is rebuilt from when the
                # conversation resumes — see `journal_from`
                # (`conversation.py`). It never goes to the evaluated model nor
                # to the judge, which read only `content`.
                "world_change": turn.world_change,
                "stop_reason": turn.stop_reason,
                # The provider's own reasoning blocks, stored because a cell
                # deepened later has to hand back to the model what it signed
                # today — see `Turn.reasoning` (`conversation.py`). Empty for
                # every turn that carries none, which is most of them.
                "reasoning": turn.reasoning,
            }
            for turn in transcript
        ]
        return state

    return solve
