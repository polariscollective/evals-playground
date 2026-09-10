"""Reading and writing evaluation runs in Supabase.

A minimal PostgREST client rather than the `supabase-py` SDK: the job performs
only a handful of operations on a couple of tables, and a dependency dragging
along its own HTTP client, authentication handling and query engine would cost
more to understand than it saves.

The service key bypasses RLS, which is enabled with no policy at all on this
project. It must therefore never leave the server: this module is imported by
the Cloud Run job, never by code that reaches a browser.
"""

import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

RUNS = "eval_runs"
SAMPLES = "eval_samples"
# The three tables of the multiple-judges feature — see `Judge`, `RunJudge` and
# `JudgeScore` in eval_schemas.py, and the migration
# `evals/supabase/migrations/20260906092100_create_judges_tables.sql`
# (polaris-supabase repository), which is authoritative on their real shape.
JUDGES = "judges"
RUN_JUDGES = "run_judges"
JUDGE_SCORES = "judge_scores"
TOOL_RESULTS = "tool_results"

TOOL_RESULT_KEY = "run_id,scenario_index,tool_name,arguments_hash,state_hash"
"""The primary key of `tool_results`, spelled the way PostgREST wants it.

Written once: it serves the insert that ignores duplicates, and must name
exactly the constraint the migration laid down — otherwise PostgREST rejects the
write instead of deduplicating it.
"""

NOW = "now()"
"""A timestamp entrusted to the database rather than to the job's clock.

PostgREST passes the value through as it stands and PostgreSQL recognises it as
input to a `timestamptz` — verified by round trip, this is not a guess. Every
timestamp therefore comes from the same clock as `updated_at`, set by a
server-side trigger: it is that consistency which makes comparable the gap that
detecting abandoned runs rests on.
"""


class SupabaseError(RuntimeError):
    """A PostgREST request failed.

    Carries the response body: PostgREST puts the name of the violated
    constraint or the offending column in it, which is the only useful thing for
    understanding what happened.
    """


@dataclass
class Supabase:
    """The strict minimum of PostgREST, on a Supabase database.

    `client` is injectable so that the tests need neither network nor database:
    it is the only point at which this module touches the outside world.
    """

    url: str
    key: str
    client: httpx.Client | None = None

    @classmethod
    def from_env(cls) -> "Supabase":
        """Builds the client from the environment.

        Fails immediately if the variables are missing: a job starting with no
        database would write its results into the void for an hour before
        anybody noticed.
        """
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise SupabaseError(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set."
            )
        return cls(url=url.rstrip("/"), key=key)

    def _client(self) -> httpx.Client:
        if self.client is None:
            self.client = httpx.Client(
                base_url=self.url,
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}"},
                timeout=30.0,
            )
        return self.client

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: Any = None,
        prefer: str | None = None,
    ) -> Any:
        headers = {"Prefer": prefer} if prefer else None
        response = self._client().request(
            method, path, params=params, json=json, headers=headers
        )
        if response.status_code >= 400:
            raise SupabaseError(
                f"{method} {path} → {response.status_code}: {response.text[:500]}"
            )
        return response.json() if response.content.strip() else None

    def select(self, table: str, **params: Any) -> list[dict]:
        return self._request("GET", f"/rest/v1/{table}", params=params) or []

    def insert(
        self,
        table: str,
        rows: Any,
        *,
        returning: bool = False,
        on_conflict: str | None = None,
    ) -> list[dict]:
        """Inserts, optionally letting duplicates through.

        `on_conflict` names the columns of the constraint to ignore. With it, a
        row that is already there is no longer an error: it is simply left as it
        stands. That is what lets two concurrent writers aim at the same key
        without the second bringing the job down — but the response then does
        not say which of the two rows lives, hence the systematic read-back at
        the call sites (see `write_tool_result`).
        """
        prefer = "return=representation" if returning else "return=minimal"
        if on_conflict is not None:
            prefer = f"resolution=ignore-duplicates,{prefer}"
        return (
            self._request(
                "POST",
                f"/rest/v1/{table}",
                params={"on_conflict": on_conflict} if on_conflict else None,
                json=rows,
                prefer=prefer,
            )
            or []
        )

    def update(self, table: str, values: dict, **filters: Any) -> None:
        self._request("PATCH", f"/rest/v1/{table}", params=filters, json=values)

    def rpc(self, function: str, arguments: dict | None = None) -> Any:
        return self._request("POST", f"/rest/v1/rpc/{function}", json=arguments or {})


# --- the runs ----------------------------------------------------------------


def fetch_run(supabase: Supabase, run_id: str) -> dict:
    """The requested run, or an explicit error if it does not exist.

    Raises:
        SupabaseError: if no run bears this identifier. A job launched on an
            unknown identifier must stop there, not run on empty.
    """
    rows = supabase.select(RUNS, id=f"eq.{run_id}", select="*", limit=1)
    if not rows:
        raise SupabaseError(f"Unknown evaluation run: {run_id!r}")
    return rows[0]


def pending_samples(supabase: Supabase, run_id: str) -> list[dict[str, Any]]:
    """The cells left to play, in the matrix's order.

    This is the only source of what the job has to do. Rebuilding the matrix
    from the configuration redoes everything, including what is already graded:
    neither replaying errors nor adding scenarios to an existing run would be
    possible.

    `turns_done` and `messages` travel too: a cell put back to pending in order
    to be deepened already carries them, and it is by their presence that
    `pending_dataset` recognises a conversation to continue rather than replay.

    `usage` and `cost_usd` travel for the same reason: a deepened cell has
    already been billed once, and it is what it carries here that lets
    `batch_job.record` add the new pass to the old rather than erase it.

    `id` travels too, since multiple judges: it is by it that
    `write_judge_score` aims at `judge_scores.sample_id`, which has no
    equivalent in the quadruple (`scenario_index`, `target_model`,
    `repetition`) the rest of this module uses to name a cell.
    """
    return supabase.select(
        SAMPLES,
        run_id=f"eq.{run_id}",
        status="eq.pending",
        select=(
            "id,scenario_index,target_model,repetition,temperature,turns_done,"
            "messages,usage,cost_usd"
        ),
        order="scenario_index,target_model,repetition",
    )


def start_run(supabase: Supabase, run_id: str, execution: str | None = None) -> None:
    """Marks the run as started.

    `error` is blanked: a pass resuming after a failure must not drag along the
    message from the previous one.
    """
    values: dict[str, Any] = {
        "status": "running",
        "started_at": NOW,
        "error": None,
    }
    if execution:
        values["execution"] = execution
    supabase.update(RUNS, values, id=f"eq.{run_id}")


def finish_run(
    supabase: Supabase,
    run_id: str,
    *,
    usage: dict[str, Any] | None = None,
    cost_usd: float | None = None,
    error: str | None = None,
    cancelled: bool = False,
) -> None:
    """Finishes the run, whether it succeeded, failed or was stopped.

    Consumption is recorded in all three cases: the tokens already burnt were
    burnt, and not writing them down would make an interrupted run look free.
    """
    supabase.update(
        RUNS,
        {
            "status": "cancelled" if cancelled else ("error" if error else "done"),
            "error": error,
            "finished_at": NOW,
            "usage": usage or {},
            "cost_usd": cost_usd,
        },
        id=f"eq.{run_id}",
    )


def run_status(supabase: Supabase, run_id: str) -> str:
    """The run's status, and nothing else.

    A single column: this read happens before every cell, and pulling back the
    whole configuration — scenarios, prompts, scale — every time to read one
    word would be absurd.
    """
    rows = supabase.select(RUNS, id=f"eq.{run_id}", select="status", limit=1)
    return str(rows[0]["status"]) if rows else ""


@dataclass
class Cancellation:
    """The stop the user asked for, seen from the job.

    Stopping is cooperative: the interface writes `cancelled` on the run, and
    the job reads it before every cell. Killing the Cloud Run execution would be
    more brutal without being cleaner — the container would die mid-write, the
    cells would stay `running` forever, and the sweep would still have to be
    waited for. Here the job ends itself.

    The answer is cached for one second: consulted before every model call, it
    would otherwise be read thousands of times for a word that changes at most
    once. One second is short against the length of a call, so stopping stays
    prompt — a longer cache let a whole wave of calls through and made the
    function useless.
    """

    supabase: Supabase
    run_id: str
    ttl_seconds: float = 1.0

    _stopped: bool = field(default=False, init=False)
    _checked_at: float = field(default=0.0, init=False)

    def stopped(self) -> bool:
        """Has the user asked to stop?

        Once true, it stays true without asking again: a cancelled run does not
        uncancel itself, and the job has nothing left to do but leave.

        A failed read — network, database unavailable — answers "no". A run that
        carries on despite a stop request is an annoyance; a run that stops
        because the network hiccuped destroys work already paid for.
        """
        if self._stopped:
            return True
        now = time.monotonic()
        if now - self._checked_at < self.ttl_seconds:
            return False
        self._checked_at = now
        try:
            self._stopped = run_status(self.supabase, self.run_id) == "cancelled"
        except SupabaseError:
            return False
        return self._stopped


# --- the samples -------------------------------------------------------------


def sample_filters(
    run_id: str, scenario_index: int, target_model: str, repetition: int
) -> dict[str, str]:
    """The filters that name exactly one cell of the matrix.

    The quadruple is the table's uniqueness constraint: aiming by it rather than
    by the row identifier makes the write idempotent, and therefore a job resume
    safe.
    """
    return {
        "run_id": f"eq.{run_id}",
        "scenario_index": f"eq.{scenario_index}",
        "target_model": f"eq.{target_model}",
        "repetition": f"eq.{repetition}",
    }


def mark_sample_running(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    target_model: str,
    repetition: int,
) -> None:
    supabase.update(
        SAMPLES,
        {"status": "running", "started_at": NOW},
        **sample_filters(run_id, scenario_index, target_model, repetition),
    )


def mark_awareness_judged(supabase: Supabase, run_id: str) -> None:
    """Notes that the awareness judge passed over this run after the fact.

    The configuration is not touched: it says what was asked for at launch, and
    that is information worth keeping. Without this date, nothing would tell a
    run launched with the judge from a run the judge was added to afterwards.
    """
    supabase.update(RUNS, {"awareness_judged_at": NOW}, id=f"eq.{run_id}")


def cancel_unfinished_samples(supabase: Supabase, run_id: str) -> None:
    """Marks `cancelled` the cells that will not be done.

    Distinct from the error sweep: a cell we decided not to do is not a cell
    that broke, and the matrix must be able to count them separately.
    """
    supabase.update(
        SAMPLES,
        {"status": "cancelled", "finished_at": NOW},
        run_id=f"eq.{run_id}",
        status="in.(pending,running)",
    )


def abandon_unfinished_samples(
    supabase: Supabase, run_id: str, reason: str
) -> None:
    """Ends in error the cells no judge ever reached.

    A sample whose solver failed never passes through the scorer, and therefore
    never through the write that finishes a cell (`record`, in `batch_job.py`):
    without this sweep it would stay `pending` on a run that is nonetheless
    finished, and the matrix would count cells to do forever.
    """
    supabase.update(
        SAMPLES,
        {"status": "error", "error": reason, "finished_at": NOW},
        run_id=f"eq.{run_id}",
        status="in.(pending,running)",
    )


# --- the judges ----------------------------------------------------------


def load_live_run_judges(supabase: Supabase, run_id: str) -> list[dict[str, Any]]:
    """THE function that loads a run's judges — the only one allowed to filter
    `run_judges` on `deleted_at`. Any code that needs to know which judges are
    live on a run — the engine, an export, an MCP tool, the screen, the quote —
    calls this one; nothing else may read `run_judges` back through a direct
    `select`.

    Copied into two reads, this filter would be forgotten in a third: this work
    has already produced two real instances of that omission — a count that
    weighed on twelve routes nobody had seen, a form that ignored a field for a
    whole plan (see the design,
    docs/superpowers/specs/2026-09-06-juges-multiples.md). An unlinked judge
    must never surface anywhere again; the only way to guarantee that is for
    there to be a single place to check.

    Each element returned carries the link as it stands, plus the judge it
    points at under the ``"judge"`` key: the caller never needs to go and read
    `judges` itself to find a live judge's criterion, scale, model or system
    type.
    """
    links = supabase.select(
        RUN_JUDGES,
        run_id=f"eq.{run_id}",
        # The only place in the repository that filters on deleted_at for this
        # table.
        deleted_at="is.null",
        # `model` is on the LINK and read from here: the model that grades left
        # `judges` the day judges became a library, and `judge_metadata`
        # (batch_job.py) has read it here since. A select that forgets it does
        # not fail on the read — it hands back a row without the key, and the
        # job dies on `KeyError: 'model'` before its first cell. That is what
        # killed the run of 10 September 2026. `tests/test_supabase_store.py`
        # pins this list, and `FakeSupabase` now projects on it.
        select="id,run_id,judge_id,model,system_type,is_principal,targets,created_at",
        order="created_at",
    )
    if not links:
        return []

    judge_ids = sorted({str(link["judge_id"]) for link in links})
    judges = supabase.select(
        JUDGES,
        id="in.(" + ",".join(judge_ids) + ")",
        # Every column named here must exist: PostgREST refuses the whole read
        # otherwise, with `column judges.x does not exist`, and the job dies
        # before its first cell. `model` was named here until it was dropped by
        # the migration `20260910100000_drop_dead_judges_model.sql` — the model
        # that grades belongs to the LINK, read just above, since judges became
        # a library. `tests/test_supabase_store.py` pins this list.
        # `grades` and `sees_adversary_goals` are read by `judge_metadata` too,
        # through `.get`: forgetting them costs no error at all, it silently
        # sends every judge back to grading the assistant without the
        # adversary's objective, whatever the judge was written to do.
        select=(
            "id,criterion,rubric,system_type,grades,sees_adversary_goals,"
            "sees_system_prompt,created_by,created_at"
        ),
    )
    by_id = {judge["id"]: judge for judge in judges}

    result: list[dict[str, Any]] = []
    for link in links:
        judge = by_id.get(link["judge_id"])
        if judge is None:
            # Should never happen: the composite foreign key
            # `run_judges_judge_fk` guarantees that a judge_id in run_judges
            # always exists in judges. A database violating its own constraint
            # deserves a loud failure, not a silent link with no judge.
            raise SupabaseError(
                f"run_judges {link['id']!r} references unknown judge"
                f" {link['judge_id']!r}."
            )
        result.append({**link, "judge": judge})
    return result


def write_judge_score(
    supabase: Supabase,
    run_judge_id: str,
    sample_id: str,
    *,
    score: float | None,
    justification: str,
    error: str | None = None,
) -> None:
    """Writes what a judge found on one conversation.

    Aims at the row by its primary key — the pair (`run_judge_id`,
    `sample_id`), unique in the database — rather than by the quadruple
    (`sample_filters`) the rest of this module uses to name a cell:
    `judge_scores` has a natural identifier that `eval_samples`, built before
    multiple judges, has no need to expose. The row already exists, `pending`,
    since the run was launched — see `judgesForLaunch` in
    `web/lib/launch-judges.ts`, which creates every score row in advance, as
    `eval_samples` already does for the matrix. This function only fills it in;
    it never creates one.

    `status` is `"error"` if `error` is set, `"done"` otherwise — whether or not
    `score` is filled (empty conversation, or grade off the scale). Three status
    values in the database for four real situations: see `JudgeScoreStatus` in
    eval_schemas.py.
    """
    supabase.update(
        JUDGE_SCORES,
        {
            "status": "error" if error else "done",
            "score": score,
            "justification": justification,
            "error": error,
        },
        run_judge_id=f"eq.{run_judge_id}",
        sample_id=f"eq.{sample_id}",
    )


# --- the tool-result cache ---------------------------------------------------
#
# What makes a tool served from the world deterministic: same scenario, same
# tool, same arguments, same world STATE, same answer — for the whole life of
# the run, extensions included. See
# docs/superpowers/specs/2026-09-07-le-monde-des-outils.md, then
# docs/superpowers/specs/2026-09-08-le-monde-qui-change.md, which added the
# fifth column.
#
# An empty `state_hash` — the vast majority of rows — gives back the earlier
# key, bit for bit: a run with no writing tool shares its cache exactly as
# before, and the rows already in the database stay valid.


def _tool_filters(
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    state_hash: str,
) -> dict[str, str]:
    """A row's primary key, as PostgREST filters.

    Written once rather than at every call: five columns copied into three
    places, and it is the third that forgets one, and an incomplete filter here
    would aim at another scenario's row — or, since `state_hash`, at the row of
    the same call in a world that is no longer the same.
    """
    return {
        "run_id": f"eq.{run_id}",
        "scenario_index": f"eq.{scenario_index}",
        "tool_name": f"eq.{tool_name}",
        "arguments_hash": f"eq.{arguments_hash}",
        "state_hash": f"eq.{state_hash}",
    }


def read_tool_result(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    state_hash: str,
) -> tuple[str, str] | None:
    """What this call already returned, or `None` if it was never made.

    `None` triggers a call to the environment model at the call site. An empty
    result, by contrast, is an answer — that of a search with no results — and
    must on no account be confused with the absence of a row.

    The effect travels with the result, and it has to: a conversation reading
    another's cache needs the same journal entry as it, otherwise the two would
    set off from the same result towards two different states.

    Returns:
        The pair (result, effect), or `None`.
    """
    rows = supabase.select(
        TOOL_RESULTS,
        select="result,world_change",
        limit=1,
        **_tool_filters(
            run_id, scenario_index, tool_name, arguments_hash, state_hash
        ),
    )
    if not rows:
        return None
    return str(rows[0]["result"] or ""), str(rows[0].get("world_change") or "")


def write_tool_result(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    state_hash: str,
    *,
    arguments: dict[str, Any],
    state: list[dict[str, Any]],
    result: str,
    reasoning: str,
    world_change: str,
    model: str,
    check_model: str = "",
    attempts: int = 1,
    faithful: bool | None = None,
    fault: str = "",
    check_error: str | None = None,
) -> tuple[str, str]:
    """Keeps this result, and returns the authoritative one.

    **First arrival wins.** The job plays several conversations in parallel: two
    cells of the same scenario may make the same call at the same time, and both
    write. The insert therefore ignores the duplicate rather than falling over,
    and the read-back that follows settles it — without which each would set off
    with its own answer, and two repetitions meant to see the same world would
    see two.

    The read-back is systematic, including when we believe we won: the response
    of an insert that ignores duplicates does not say which of the two rows
    lives.

    `state` carries the readable journal beside its fingerprint, as `arguments`
    travels beside `arguments_hash`: that is what lets the after-run pass
    recheck a row, and lets the world it was served against be read back six
    months later.

    `reasoning` is recorded and never comes back out towards a conversation.
    When `faithful` is false, it is what says what the server believed it was
    doing — the half `fault` does not give.

    `check_model` says who checked. It makes the spec's fallback visible: when
    it shares `model`'s provider, the checker carries the bias of the one it is
    checking — better than no check, but something to be known rather than
    guessed.

    `attempts` is 2 when a repair took place. With `faithful` false, that is the
    fifth outcome of the indicator: served despite a failed repair, which is
    none of the other four.

    Returns:
        The authoritative pair (result, effect) — its own, or the one that was
        already there.
    """
    row: dict[str, Any] = {
        "run_id": run_id,
        "scenario_index": scenario_index,
        "tool_name": tool_name,
        "arguments_hash": arguments_hash,
        "state_hash": state_hash,
        "arguments": arguments,
        "state": state,
        "result": result,
        "reasoning": reasoning,
        "world_change": world_change,
        "model": model,
        "check_model": check_model,
        "attempts": attempts,
        "fault": fault,
        "check_error": check_error,
    }
    if faithful is not None:
        row["faithful"] = faithful
    supabase.insert(TOOL_RESULTS, row, on_conflict=TOOL_RESULT_KEY)
    kept = read_tool_result(
        supabase, run_id, scenario_index, tool_name, arguments_hash, state_hash
    )
    # `None` can only happen if the row disappeared between the write and the
    # read-back, which nothing does: nobody deletes from this table. Serving our
    # own rather than falling over keeps the conversation alive.
    return (result, world_change) if kept is None else kept


def unchecked_tool_results(supabase: Supabase, run_id: str) -> list[dict[str, Any]]:
    """This run's results that have not been checked yet.

    `faithful is null` is what remains to be done, read rather than recomputed —
    exactly as `judge_scores.status` already carries "what remains to be
    graded". Two rules written in two places for the same question end up
    drifting apart, and this repository has already paid that price once.

    Now that the check happens inline first, this pass is a net: it picks up
    what a checker failure had left aside. `state` and `world_change` are part
    of it — without them, it would recheck the row against a world that is not
    the one it saw.
    """
    return supabase.select(
        TOOL_RESULTS,
        select=(
            "scenario_index,tool_name,arguments_hash,state_hash,arguments,state,"
            "result,world_change"
        ),
        run_id=f"eq.{run_id}",
        faithful="is.null",
    )


def write_tool_verdict(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    state_hash: str,
    *,
    faithful: bool,
    fault: str,
) -> None:
    """What the check found on this result.

    It never rewrites `result`: what was served is what a conversation actually
    saw, and correcting it after the fact would make that transcript
    inexplicable.

    It also clears `check_error`: a check that succeeds contradicts the last
    time it failed. Without that, a transient failure would leave a stale reason
    on a row that has since been checked.
    """
    supabase.update(
        TOOL_RESULTS,
        {"faithful": faithful, "fault": fault, "check_error": None},
        **_tool_filters(
            run_id, scenario_index, tool_name, arguments_hash, state_hash
        ),
    )


def write_tool_check_error(
    supabase: Supabase,
    run_id: str,
    scenario_index: int,
    tool_name: str,
    arguments_hash: str,
    state_hash: str,
    *,
    reason: str,
) -> None:
    """Why this row could not be checked.

    `faithful` is not touched: it stays null, because we do not know. The row
    will therefore come round again at the next check, and a success will clear
    this reason — it is the latest one, not a verdict.
    """
    supabase.update(
        TOOL_RESULTS,
        {"check_error": reason},
        **_tool_filters(
            run_id, scenario_index, tool_name, arguments_hash, state_hash
        ),
    )
