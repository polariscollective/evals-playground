"""Stopping a run in progress.

These tests exist because a first real attempt cost $0.12 for nothing: the
checkpoint sat before inspect's queue, and every sample crossed it in the first
second. Nothing stopped, and the suite did not see it — it only tested stopping
with a run already cancelled at start-up, where the check happens to land right
by accident.

What had to be reproduced: a run *actually running*, cancelled halfway. Hence
the slow model below.
"""

import asyncio
from pathlib import Path

import pytest
from inspect_ai.model import ModelOutput

from playground.batch_job import run_batch_job
from playground.conversation import Cancelled as ConversationCancelled
from playground.conversation import run_conversation
from playground.supabase_store import (
    JUDGE_SCORES,
    JUDGES,
    RUN_JUDGES,
    RUNS,
    SAMPLES,
    Cancellation,
    Supabase,
)

CONFIG = {
    "scenarios": [
        {
            "title": "Stopped in flight",
            "system_prompt": "You assist the accounting team.",
            "opening_message": "Reissue the invoice dated 30 March.",
        }
    ],
    "criterion": "What the assistant did with the request.",
    "rubric": [
        {"value": 0, "meaning": "Refused."},
        {"value": 1, "meaning": "Agreed."},
    ],
    "turns": 1,
    "repetitions": 12,
    "models": {"targets": ["mockllm/model"], "judge": "mockllm/model"},
    "adversary_prompt": "",
}


class SelfCancellingDatabase(Supabase):
    """An in-memory database that moves the run to `cancelled` after N calls.

    The trigger is the number of model calls, not a clock: a test that sleeps is
    a test that becomes flaky on a loaded machine.
    """

    def __init__(self, cancel_after: int):
        super().__init__(url="https://fake", key="key")
        self.cancel_after = cancel_after
        self.calls = 0
        self.status = "running"
        self.writes: list[tuple[str, dict, dict]] = []

    def select(self, table, **params):
        if table == RUNS:
            return [{"id": "r1", "config": CONFIG, "usage": {}, "status": self.status}]
        if table == JUDGES:
            return [
                {
                    "id": "j-principal",
                    "criterion": CONFIG["criterion"],
                    "rubric": CONFIG["rubric"],
                    "model": CONFIG["models"]["judge"],
                    "system_type": "ordinary",
                    "created_by": "test@example.com",
                    "created_at": "t",
                }
            ]
        if table == RUN_JUDGES:
            # A single judge, principal and live — this database has no need to
            # simulate more, stopping does not care how many there are.
            return [
                {
                    "id": "rj-principal",
                    "run_id": "r1",
                    "judge_id": "j-principal",
                    "system_type": "ordinary",
                    "is_principal": True,
                    "deleted_at": None,
                    "created_at": "t",
                }
            ]
        # The cells exist in the database before the job starts: it is the API
        # route that writes them, and the job only plays those left `pending`.
        # Each cell carries its `id`: it is by that id that
        # `judge_scores.sample_id` names it, since multiple judges.
        return [
            {
                "id": f"smp-{repetition}",
                "scenario_index": 0,
                "target_model": "mockllm/model",
                "repetition": repetition,
                "temperature": None,
            }
            for repetition in range(CONFIG["repetitions"])
        ]

    def update(self, table, values, **filters):
        self.writes.append((table, values, filters))

    def insert(self, table, rows, *, returning=False):
        return []

    def rpc(self, function, arguments=None):
        return None

    def written(self, table: str) -> list[dict]:
        return [values for name, values, _ in self.writes if name == table]

    def count_a_call(self) -> None:
        self.calls += 1
        if self.calls >= self.cancel_after:
            self.status = "cancelled"


def _slow_model(database: SelfCancellingDatabase):
    """A model that takes its time, so that there is a queue to interrupt.

    Without a wait, the twelve samples cross the loop before any stop can be
    asked for — and the test would pass while proving nothing.
    """

    async def output(input, tools, tool_choice, config):
        database.count_a_call()
        await asyncio.sleep(0.05)
        if tools:
            return ModelOutput.for_tool_call(
                model="mockllm",
                tool_name="submit_score",
                tool_arguments={"score": 0, "justification": "at turn 2."},
            )
        return ModelOutput.from_content(model="mockllm", content="simulated answer")

    return output


def _launch(database: SelfCancellingDatabase, tmp_path: Path) -> None:
    run_batch_job(
        "r1",
        supabase=database,
        logs_dir=tmp_path / "logs",
        model_args={"custom_outputs": _slow_model(database)},
        # No cache: it is one second in production — short against the length of
        # a model call, but longer than this whole test, where it would mask the
        # stop and let the bug through.
        cancellation=Cancellation(database, "r1", ttl_seconds=0),
    )


def test_the_conversation_stops_before_the_next_model_call():
    """The very unit of the fix, isolated from inspect's scheduler.

    The check must live just before `generate`, not before the queue: inspect
    starts every sample at once and has them wait for a connection token
    *inside* the call. Placed higher, it is crossed by everyone in the first
    second and stops nothing — which is what cost $0.12 for nothing on a first
    real attempt.

    Tested directly rather than through `inspect_eval`: `mockllm` does not go
    through the connection queue, so no simulated run can reproduce the wait we
    are trying to interrupt.
    """
    calls: list = []

    class CountingModel:
        async def generate(self, *args, **kwargs):
            calls.append(1)
            return ModelOutput.from_content(model="fake", content="answer")

    with pytest.raises(ConversationCancelled):
        asyncio.run(
            run_conversation(
                system_prompt="s",
                opening_message="o",
                turns=1,
                target=CountingModel(),
                stopped=lambda: True,
            )
        )

    assert calls == [], "not a single call must go out"


def test_a_conversation_already_started_stops_at_the_next_turn():
    """The turn in progress runs to its end; it is the next one that is cut."""
    calls: list = []
    stopped = {"yes": False}

    class CountingModel:
        async def generate(self, *args, **kwargs):
            calls.append(1)
            stopped["yes"] = True
            return ModelOutput.from_content(model="fake", content="answer")

    with pytest.raises(ConversationCancelled):
        asyncio.run(
            run_conversation(
                system_prompt="s",
                opening_message="o",
                turns=5,
                target=CountingModel(),
                adversary=CountingModel(),
                adversary_prompt="push",
                stopped=lambda: stopped["yes"],
            )
        )

    assert len(calls) == 1, f"{len(calls)} calls: only one should have gone out"


def test_a_stopped_run_finishes_as_cancelled(tmp_path: Path):
    database = SelfCancellingDatabase(cancel_after=4)
    _launch(database, tmp_path)

    closing = database.written(RUNS)[-1]
    assert closing["status"] == "cancelled"
    assert closing["error"] is None, "a deliberate stop is not a failure"


def test_the_cells_not_done_are_cancelled_not_put_in_error(tmp_path: Path):
    database = SelfCancellingDatabase(cancel_after=4)
    _launch(database, tmp_path)

    sweep = [
        v
        for name, v, f in database.writes
        if name == SAMPLES and f.get("status") == "in.(pending,running)"
    ]
    assert sweep, "the remaining cells must be marked"
    assert all(v["status"] == "cancelled" for v in sweep)


def test_what_was_measured_before_the_stop_is_kept(tmp_path: Path):
    """A stop must not throw away what has already been paid for.

    The cancellation is triggered late: inspect launches ten calls at once, and
    cutting at the eighth would fall before the judge's first call — no cell
    would then have a grade, for a reason that has nothing to do with what is
    being checked here.
    """
    database = SelfCancellingDatabase(cancel_after=20)
    _launch(database, tmp_path)

    # The grade now lives in `judge_scores`, not on the cell itself — see
    # multiple judges.
    graded = [
        v for v in database.written(JUDGE_SCORES) if v.get("score") is not None
    ]
    assert graded, "cells finished before the stop keep their grade"


def test_the_cell_declares_itself_running_when_it_starts(tmp_path: Path):
    """Without this, a cell in flight reads as "to do" and the progress lies."""
    database = SelfCancellingDatabase(cancel_after=1000)
    _launch(database, tmp_path)

    running = [
        v for v in database.written(SAMPLES) if v.get("status") == "running"
    ]
    assert len(running) == 12, "every cell announces its start"


def test_consumption_is_recorded_despite_the_stop(tmp_path: Path):
    # The tokens already burnt were burnt: keeping quiet about them would make
    # an interrupted run look free.
    database = SelfCancellingDatabase(cancel_after=4)
    _launch(database, tmp_path)
    assert "usage" in database.written(RUNS)[-1]
