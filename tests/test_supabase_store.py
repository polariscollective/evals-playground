"""The Supabase store: what goes out on the network, and what comes back."""

import json

import httpx
import pytest

from playground.supabase_store import (
    NOW,
    Supabase,
    SupabaseError,
    abandon_unfinished_samples,
    fetch_run,
    finish_run,
    load_live_run_judges,
    mark_sample_running,
    read_tool_result,
    sample_filters,
    start_run,
    unchecked_tool_results,
    write_judge_score,
    write_tool_check_error,
    write_tool_result,
    write_tool_verdict,
)


def _supabase(handler) -> tuple[Supabase, list[httpx.Request]]:
    """A client wired to a test transport, and the log of requests."""
    sent: list[httpx.Request] = []

    def transport(request: httpx.Request) -> httpx.Response:
        sent.append(request)
        return handler(request)

    client = httpx.Client(
        base_url="https://example.supabase.co",
        headers={"apikey": "key", "Authorization": "Bearer key"},
        transport=httpx.MockTransport(transport),
    )
    return (
        Supabase(url="https://example.supabase.co", key="key", client=client),
        sent,
    )


def _ok(payload=None):
    return lambda request: httpx.Response(200, json=payload if payload is not None else [])


def _body(request: httpx.Request) -> dict | list:
    return json.loads(request.content.decode())


# --- construction ------------------------------------------------------------


def test_without_environment_variables_the_failure_is_immediate(monkeypatch):
    """A job starting with no database would write into the void for an hour."""
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    with pytest.raises(SupabaseError, match="SUPABASE_URL"):
        Supabase.from_env()


def test_the_url_loses_its_trailing_slash(monkeypatch):
    # Without this, every path would carry a double slash.
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "key")
    assert Supabase.from_env().url == "https://example.supabase.co"


# --- the transport -----------------------------------------------------------


def test_a_postgrest_error_carries_the_response_body():
    """PostgREST puts the violated constraint in it: the only useful thing."""
    supabase, _ = _supabase(
        lambda r: httpx.Response(409, text='{"code":"23505","message":"duplicate key"}')
    )
    with pytest.raises(SupabaseError, match="duplicate key"):
        supabase.select("eval_runs")


def test_an_empty_response_does_not_break_decoding():
    # PATCH returns 204 with no body; decoding it would fail every write.
    supabase, _ = _supabase(lambda r: httpx.Response(204))
    assert supabase.update("eval_runs", {"status": "done"}, id="eq.1") is None


# --- the runs ----------------------------------------------------------------


def test_an_unknown_run_is_an_explicit_error():
    supabase, _ = _supabase(_ok([]))
    with pytest.raises(SupabaseError, match="Unknown evaluation run"):
        fetch_run(supabase, "absent")


def test_starting_clears_the_previous_error():
    """A resume must not drag along the failed pass's message."""
    supabase, sent = _supabase(_ok())
    start_run(supabase, "r1", execution="executions/abc")

    body = _body(sent[0])
    assert body["status"] == "running"
    assert body["error"] is None
    assert body["started_at"] == NOW
    assert body["execution"] == "executions/abc"


def test_without_an_execution_the_column_is_not_overwritten():
    # A run relaunched by hand has no Cloud Run execution; writing `null`
    # would erase the one from a previous pass.
    supabase, sent = _supabase(_ok())
    start_run(supabase, "r1")
    assert "execution" not in _body(sent[0])


def test_finishing_with_an_error_gives_the_error_status():
    supabase, sent = _supabase(_ok())
    finish_run(supabase, "r1", usage={"m": {"input_tokens": 5}}, error="bang")

    body = _body(sent[0])
    assert body["status"] == "error"
    assert body["error"] == "bang"
    # Consumption is recorded even on a failed run: those tokens were billed,
    # and keeping quiet about them would make the run look free.
    assert body["usage"] == {"m": {"input_tokens": 5}}


def test_finishing_without_an_error_gives_the_done_status():
    supabase, sent = _supabase(_ok())
    finish_run(supabase, "r1", cost_usd=1.25)
    body = _body(sent[0])
    assert body["status"] == "done"
    assert body["error"] is None
    assert body["cost_usd"] == 1.25


# --- the samples -------------------------------------------------------------


def test_a_cell_is_named_by_its_quadruple():
    """Aiming by the uniqueness constraint rather than by the row identifier:
    that is what makes the write idempotent, and so a resume safe."""
    assert sample_filters("r1", 2, "m", 3) == {
        "run_id": "eq.r1",
        "scenario_index": "eq.2",
        "target_model": "eq.m",
        "repetition": "eq.3",
    }


def test_marking_a_cell_running_touches_only_its_status_and_its_date():
    supabase, sent = _supabase(_ok())
    mark_sample_running(supabase, "r1", 0, "m", 0)
    assert _body(sent[0]) == {"status": "running", "started_at": NOW}


def test_the_sweep_targets_only_the_unfinished_cells():
    """A cell already graded must not be overwritten by the closing sweep."""
    supabase, sent = _supabase(_ok())
    abandon_unfinished_samples(supabase, "r1", "the job stopped")

    url = str(sent[0].url)
    assert "status=in.%28pending%2Crunning%29" in url or "status=in.(pending,running)" in url
    assert _body(sent[0])["error"] == "the job stopped"


# --- cooperative stopping ----------------------------------------------------


def test_the_stop_is_read_from_the_database_then_cached():
    """A matrix of five hundred cells must not make five hundred requests to
    read one word that changes once."""
    from playground.supabase_store import Cancellation

    supabase, sent = _supabase(_ok([{"status": "running"}]))
    stop = Cancellation(supabase, "r1", ttl_seconds=60)

    assert stop.stopped() is False
    assert stop.stopped() is False
    assert len(sent) == 1, "the second read comes from the cache"


def test_once_stopped_it_stays_stopped_without_asking_again():
    from playground.supabase_store import Cancellation

    supabase, sent = _supabase(_ok([{"status": "cancelled"}]))
    stop = Cancellation(supabase, "r1", ttl_seconds=0)

    assert stop.stopped() is True
    assert stop.stopped() is True
    assert len(sent) == 1, "a cancelled run does not uncancel itself"


def test_a_failed_read_does_not_cause_a_stop():
    """A run that carries on despite a stop request is an annoyance; a run that
    stops because the network hiccuped destroys work already paid for."""
    from playground.supabase_store import Cancellation

    supabase, _ = _supabase(lambda r: httpx.Response(500, text="bang"))
    assert Cancellation(supabase, "r1", ttl_seconds=0).stopped() is False


def test_the_cells_not_done_are_cancelled_separately():
    from playground.supabase_store import cancel_unfinished_samples

    supabase, sent = _supabase(_ok())
    cancel_unfinished_samples(supabase, "r1")

    body = _body(sent[0])
    assert body["status"] == "cancelled"
    assert "error" not in body, "a cancelled cell has no error message"


def test_finishing_on_a_stop_gives_the_cancelled_status():
    supabase, sent = _supabase(_ok())
    finish_run(supabase, "r1", cancelled=True)
    body = _body(sent[0])
    assert body["status"] == "cancelled"
    assert body["error"] is None


# --- the judges ----------------------------------------------------------


def test_the_live_judges_merge_link_and_configuration():
    """Two requests: the live links, then the judges they point at — never the
    other way round, and never more."""

    def handler(request: httpx.Request) -> httpx.Response:
        if "/rest/v1/run_judges" in str(request.url):
            assert "deleted_at=is.null" in str(request.url)
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "rj1",
                        "run_id": "r1",
                        "judge_id": "j1",
                        "system_type": "ordinary",
                        "is_principal": True,
                        "created_at": "t",
                    },
                    {
                        "id": "rj2",
                        "run_id": "r1",
                        "judge_id": "j2",
                        "system_type": "awake",
                        "is_principal": False,
                        "created_at": "t",
                    },
                ],
            )
        assert "/rest/v1/judges" in str(request.url)
        return httpx.Response(
            200,
            json=[
                {
                    "id": "j1",
                    "criterion": "Did it give in?",
                    "rubric": [{"value": 1, "meaning": "no"}],
                    "model": "m",
                    "system_type": "ordinary",
                    "created_by": "a@b.c",
                    "created_at": "t",
                },
                {
                    "id": "j2",
                    "criterion": None,
                    "rubric": None,
                    "model": "m",
                    "system_type": "awake",
                    "created_by": "a@b.c",
                    "created_at": "t",
                },
            ],
        )

    supabase, sent = _supabase(handler)
    judges = load_live_run_judges(supabase, "r1")

    assert len(sent) == 2
    assert len(judges) == 2
    assert judges[0]["is_principal"] is True
    assert judges[0]["judge"]["criterion"] == "Did it give in?"
    assert judges[1]["system_type"] == "awake"
    assert judges[1]["judge"]["system_type"] == "awake"


def test_with_no_live_link_the_judges_are_not_read():
    """A second request for zero links would be a round trip for nothing."""
    supabase, sent = _supabase(_ok([]))
    assert load_live_run_judges(supabase, "r1") == []
    assert len(sent) == 1


def test_a_link_with_no_matching_judge_is_a_loud_error():
    # Should never happen — the composite foreign key forbids it in the
    # database — but a database violating its own constraint must break loudly,
    # not silently return a link with no judge.
    def handler(request: httpx.Request) -> httpx.Response:
        if "/rest/v1/run_judges" in str(request.url):
            return httpx.Response(
                200,
                json=[
                    {
                        "id": "rj1",
                        "run_id": "r1",
                        "judge_id": "j1",
                        "system_type": "ordinary",
                        "is_principal": True,
                        "created_at": "t",
                    }
                ],
            )
        return httpx.Response(200, json=[])

    supabase, _ = _supabase(handler)
    with pytest.raises(SupabaseError, match="j1"):
        load_live_run_judges(supabase, "r1")


def test_writing_a_judges_grade_aims_at_the_row_by_its_primary_key():
    supabase, sent = _supabase(_ok())
    write_judge_score(supabase, "rj1", "s1", score=2.0, justification="clear.")

    sent_request = sent[0]
    assert sent_request.method == "PATCH"
    assert "run_judge_id=eq.rj1" in str(sent_request.url)
    assert "sample_id=eq.s1" in str(sent_request.url)
    body = _body(sent_request)
    assert body == {
        "status": "done",
        "score": 2.0,
        "justification": "clear.",
        "error": None,
    }


def test_writing_a_judges_failure_gives_the_error_status():
    supabase, sent = _supabase(_ok())
    write_judge_score(
        supabase, "rj1", "s1", score=None, justification="", error="the judge fell over"
    )
    body = _body(sent[0])
    assert body["status"] == "error"
    assert body["score"] is None
    assert body["error"] == "the judge fell over"


# --- the tool-result cache ---------------------------------------------------
#
# See docs/superpowers/specs/2026-09-07-le-monde-des-outils.md. The job plays
# the conversations in parallel: two cells may make the same call at the same
# time, and it is the first to arrive that wins.


def test_a_result_absent_from_the_cache_reads_as_absent():
    supabase, _ = _supabase(_ok([]))
    assert read_tool_result(supabase, "run-1", 0, "search_files", "abc", "") is None


def test_a_result_that_is_there_comes_back_with_its_effect():
    """The effect travels with the result: a conversation reading another's
    cache needs the same journal entry as it, otherwise the two would set off
    from the same result towards two different states."""
    supabase, sent = _supabase(
        _ok([{"result": "contracts/2026-03.pdf", "world_change": ""}])
    )
    assert read_tool_result(supabase, "run-1", 2, "search_files", "abc", "") == (
        "contracts/2026-03.pdf",
        "",
    )
    params = dict(sent[0].url.params)
    assert params["run_id"] == "eq.run-1"
    assert params["scenario_index"] == "eq.2"
    assert params["arguments_hash"] == "eq.abc"


def test_the_same_call_in_two_states_aims_at_two_rows():
    """The fifth column: two conversations that did not make the same writes do
    not share their answer, and that is the point."""
    supabase, sent = _supabase(_ok([]))
    read_tool_result(supabase, "run-1", 2, "search_files", "abc", "e7f3")
    assert dict(sent[0].url.params)["state_hash"] == "eq.e7f3"


def test_an_empty_journal_keeps_the_key_from_before_this_work():
    """An empty fingerprint for the vast majority of rows — a run with no
    writing tool shares its cache exactly as before."""
    supabase, sent = _supabase(_ok([]))
    read_tool_result(supabase, "run-1", 2, "search_files", "abc", "")
    assert dict(sent[0].url.params)["state_hash"] == "eq."


def test_writing_a_result_ignores_duplicates():
    """Otherwise two cells of the same scenario would set off with two
    different worlds."""
    sent_per_call = []

    def handler(request):
        sent_per_call.append(request)
        if request.method == "POST":
            return httpx.Response(201, json=[])
        return httpx.Response(200, json=[{"result": "the first to arrive"}])

    supabase, _ = _supabase(handler)
    returned = write_tool_result(
        supabase,
        "run-1",
        0,
        "search_files",
        "abc",
        "",
        arguments={"query": "X"},
        state=[],
        result="the second to arrive",
        reasoning="two files match",
        world_change="",
        model="openai/gpt-5.6-luna",
    )
    post = sent_per_call[0]
    assert post.method == "POST"
    assert "ignore-duplicates" in post.headers["Prefer"]
    assert dict(post.url.params)["on_conflict"] == (
        "run_id,scenario_index,tool_name,arguments_hash,state_hash"
    )
    # We always read back: it is the read-back that settles it, not the POST's
    # response, which does not say whether the row was written or ignored.
    assert returned == ("the first to arrive", "")


def test_the_reasoning_and_the_journal_are_kept_with_the_result():
    """`reasoning` is the half `fault` does not give — what the server believed
    it was doing. `state` carries the readable journal beside its fingerprint,
    as `arguments` travels beside `arguments_hash`: without it, the after-run
    pass would recheck the row against a world that is not its own."""
    supabase, sent = _supabase(_ok([{"result": "Deleted.", "world_change": "gone"}]))
    write_tool_result(
        supabase,
        "run-1",
        0,
        "delete_file",
        "abc",
        "e7f3",
        arguments={"path": "x"},
        state=[
            {"tool": "delete_file", "arguments": {}, "result": "ok", "effect": "gone"}
        ],
        result="Deleted.",
        reasoning="the file existed",
        world_change="gone",
        model="openai/gpt-5.6-luna",
        check_model="anthropic/claude-haiku-4-5",
        attempts=2,
        faithful=False,
        fault="invented a path",
    )
    body = _body(sent[0])
    assert body["reasoning"] == "the file existed"
    assert body["world_change"] == "gone"
    assert body["state_hash"] == "e7f3"
    assert body["state"][0]["effect"] == "gone"
    assert body["check_model"] == "anthropic/claude-haiku-4-5"
    # The indicator's fifth outcome: served despite a failed repair, which is
    # none of the other four.
    assert body["attempts"] == 2
    assert body["faithful"] is False


def test_the_rows_to_check_are_those_with_no_verdict():
    """`faithful is null` is what the catch-up reads — as
    `judge_scores.status` already does for the judges."""
    supabase, sent = _supabase(_ok([]))
    unchecked_tool_results(supabase, "run-1")
    params = dict(sent[0].url.params)
    assert params["run_id"] == "eq.run-1"
    assert params["faithful"] == "is.null"


def test_the_checks_verdict_aims_at_the_row_by_its_key():
    supabase, sent = _supabase(_ok())
    write_tool_verdict(
        supabase,
        "run-1",
        3,
        "search_files",
        "abc",
        "",
        faithful=False,
        fault="invented a file",
    )
    body = _body(sent[0])
    assert body == {
        "faithful": False,
        "fault": "invented a file",
        "check_error": None,
    }
    params = dict(sent[0].url.params)
    assert params["scenario_index"] == "eq.3"
    assert params["tool_name"] == "eq.search_files"


def test_a_verdict_clears_an_earlier_failure_reason():
    """A check that succeeds contradicts the last time it failed — otherwise a
    transient failure would leave a stale reason on a row that has since been
    checked."""
    supabase, sent = _supabase(_ok())
    write_tool_verdict(
        supabase, "run-1", 3, "search_files", "abc", "", faithful=True, fault=""
    )
    body = _body(sent[0])
    assert body["check_error"] is None


def test_the_reason_for_a_failed_check_aims_at_the_row_by_its_key():
    """`faithful` is deliberately not in the body: the row stays null, because
    we do not know — only the reason for not knowing is written."""
    supabase, sent = _supabase(_ok())
    write_tool_check_error(
        supabase,
        "run-1",
        3,
        "search_files",
        "abc",
        "",
        reason="AuthenticationError: invalid key",
    )
    body = _body(sent[0])
    assert body == {"check_error": "AuthenticationError: invalid key"}
    assert "faithful" not in body
    params = dict(sent[0].url.params)
    assert params["run_id"] == "eq.run-1"
    assert params["scenario_index"] == "eq.3"
    assert params["tool_name"] == "eq.search_files"
    assert params["arguments_hash"] == "eq.abc"
