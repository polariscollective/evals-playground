"""Running an evaluation run, inside a Cloud Run job.

Entry point: `python -m playground.batch_job`.

Everything comes through the environment, never the command line: Cloud Run Jobs
can substitute environment variables at launch, not arguments.

    EVAL_RUN_ID     the run to execute, already in the database with its samples
    EVAL_JOB_MODE   `run` (default) or `catchup`
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    ANTHROPIC_API_KEY, OPENAI_API_KEY, XAI_API_KEY, GEMINI_API_KEY

The job invents nothing: the matrix already exists in the database, one row per
cell, `pending`. All it does is fill them in. Since multiple judges, that is
true of `judge_scores` too: every score row exists in advance, `pending`, for
each live judge of the run — see
docs/superpowers/specs/2026-09-06-juges-multiples.md.
"""

import asyncio
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Callable

from inspect_ai import Task, eval as inspect_eval
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.log import EvalLog
from inspect_ai.model import get_model
from inspect_ai.solver import Generate, Solver, TaskState, solver

from playground.conversation import ToolAnswer
from playground.eval_schemas import EvalRunConfig, JournalEntry, ToolSpec
from playground.log_store import Storage, upload_logs
from playground.eval_task import conversation_solver, pending_dataset
from playground.pricing import actual_cost
from playground.scoring import JudgeOutcome, ScoredSample, judges_scorer
from playground.supabase_store import (
    JUDGE_SCORES,
    NOW,
    SAMPLES,
    Cancellation,
    Supabase,
    abandon_unfinished_samples,
    cancel_unfinished_samples,
    fetch_run,
    finish_run,
    load_live_run_judges,
    mark_sample_running,
    pending_samples,
    read_tool_result,
    run_status,
    unchecked_tool_results,
    sample_filters,
    start_run,
    write_judge_score,
    write_tool_check_error,
    write_tool_result,
    write_tool_verdict,
)
from playground.world import (
    ServeRefused,
    check,
    check_model_for,
    check_models_after,
    result_key,
    serve,
    state_key,
)

LOGS_DIR = Path(os.environ.get("EVAL_LOGS_DIR", "logs/eval"))


def usage_from_log(log: EvalLog) -> dict[str, dict[str, int]]:
    """The tokens actually consumed, per model.

    Inspect aggregates these counters from the providers' responses: they are
    the numbers billed, not an estimate. Missing fields count as zero — not
    every provider reports cache or reasoning.
    """
    return {
        model: {
            "input_tokens": counts.input_tokens or 0,
            "output_tokens": counts.output_tokens or 0,
            "input_tokens_cache_read": counts.input_tokens_cache_read or 0,
            "input_tokens_cache_write": counts.input_tokens_cache_write or 0,
            "reasoning_tokens": counts.reasoning_tokens or 0,
        }
        for model, counts in (log.stats.model_usage or {}).items()
    }


def add_usage(
    existing: dict[str, Any], added: dict[str, dict[str, int]]
) -> dict[str, dict[str, int]]:
    """Adds one pass's consumption to what is already recorded.

    The tokens of a previous pass were billed: replacing them would make a run
    look cheaper than it was. A run's cost is that of everything it has been put
    through, not of its last operation.
    """
    total: dict[str, dict[str, int]] = {
        model: dict(counts) for model, counts in (existing or {}).items()
    }
    for model, counts in added.items():
        current = total.setdefault(model, {})
        for field, value in counts.items():
            current[field] = current.get(field, 0) + value
    return total


def judge_metadata(link: dict[str, Any]) -> dict[str, Any]:
    """A live judge, reduced to what `judges_scorer` (scoring.py) has to
    receive in order to have it grade a conversation.

    `link` is one element of what `load_live_run_judges` (supabase_store.py)
    returns: the `run_judges` link merged with the judge it points at, under the
    `"judge"` key. This function keeps only what crosses the JSON boundary of
    `Sample.metadata` — see `playground.scoring.judge_from_metadata`, which
    makes the return trip on the scorer side.
    """
    judge = link["judge"]
    return {
        "run_judge_id": str(link["id"]),
        # Sur la LIAISON, jamais sur le juge : le modèle en est sorti le jour où
        # les juges sont devenus une bibliothèque, et le lire encore là ne
        # trouverait plus rien.
        "model": link["model"],
        "system_type": judge.get("system_type"),
        "criterion": judge.get("criterion"),
        "rubric": judge.get("rubric"),
        # Decides whether the transcript handed to THIS judge carries the
        # scenario's system prompt. Absent means true — the behaviour from
        # before this field.
        #
        # `targets` does not cross: it is a lab annotation, like a scenario's
        # note, and it has no business near a judge. Giving it to the judge
        # would be giving it the answer.
        "sees_system_prompt": judge.get("sees_system_prompt", True) is not False,
    }


def world_for(config: EvalRunConfig, scenario_index: int) -> str:
    """The world as a scenario reads it: the run's, plus its own.

    Rebuilt here rather than stored per result: a run's world is frozen at
    launch, so it cannot have moved, and keeping a copy of it on every
    `tool_results` row would cost the whole world that many times over.

    Written once for both checks — the one inline in the conversation and the
    after-run pass. Copied, it is the second copy that would forget the
    scenario's world, and the checker would then condemn perfectly correct
    reads.
    """
    world = config.world
    if 0 <= scenario_index < len(config.scenarios):
        from_scenario = config.scenarios[scenario_index].world
        if from_scenario:
            world = f"{world}\n\n{from_scenario}"
    return world


def world_server(
    supabase: Supabase,
    run_id: str,
    config: EvalRunConfig,
    model_args: dict[str, Any] | None = None,
) -> "Callable[..., Any]":
    """What answers served tools, for the length of a job.

    A factory rather than a free function, because there is state to hold: the
    checkers we have watched fall over. A job runs a single run in a single
    process, and that is the right scale for this memory — see below.

    Handed to `conversation_solver`, which closes it over the scenario's rank.
    """

    # The checkers we have watched fall over, remembered for the whole job.
    #
    # A provider failure is at the scale of the run, not of the conversation:
    # remembered per attempt, a hundred and twenty conversations would each
    # rediscover it, at the price of a hundred and twenty waits. The job runs a
    # single run in a single process, and it already keeps a memory of this
    # shape for cancellation.
    failed_checkers: list[str] = []

    async def run_check(
        world: str,
        journal: "list[JournalEntry]",
        tool_name: str,
        arguments: dict[str, Any],
        result: str,
        world_change: str,
    ) -> tuple[tuple[bool, str] | None, str, str]:
        """One checker's verdict, working down the list of candidates.

        The fallback from the spec, in order: a family other than the server's
        first, the same one next — a checker with a shared bias beats no check
        at all, and `check_model` on the row makes it visible — then nobody
        left.

        **A checker failing never kills an attempt.** It returns a null verdict,
        the caller serves anyway, and the row keeps a null `faithful`: the
        after-run pass will pick it up.

        Returns:
            The triple (verdict, checker used, reason for failure). The verdict
            is null when no candidate could answer.
        """
        last = ""
        while True:
            candidate = check_models_after(config.models.world or "", failed_checkers)
            if candidate is None:
                return None, "", last or "no checker could be reached"
            try:
                verdict = await check(
                    model=get_model(candidate, **(model_args or {})),
                    world=world,
                    journal=journal,
                    tool=tool_name,
                    arguments=arguments,
                    result=result,
                    world_change=world_change,
                )
                return verdict, candidate, ""
            except Exception as reason:  # noqa: BLE001 — see the docstring
                failed_checkers.append(candidate)
                last = f"{candidate}: {reason}"

    async def serve_tool(
        scenario_index: int,
        tool: ToolSpec,
        arguments: dict[str, Any],
        journal: "list[JournalEntry]",
    ) -> ToolAnswer:
        """What a tool served from the world returns for this call.

        The cache first, always: an answer already written is served again
        without any model being called — neither the server nor the checker,
        which has already looked at that row. That is what makes two repetitions
        of the same scenario comparable, what stops an extension paying again
        for what has already been asked, and what keeps the check at the price
        of the number of DIFFERENT answers rather than the number of calls.

        The key carries the state of the world from BEFORE this call. An empty
        journal — the case for the vast majority of calls — gives the key from
        before this work.

        An empty result is an answer — that of a search with no results — and
        not an absence: it is `None` that says "never asked", and `None` alone
        triggers a call.

        The check happens **before** serving, and no longer only after the run:
        it is the only way to retry once before the evaluated model has read the
        answer. Once it has read it, it is too late — we do not rewrite a
        transcript.

        Two outcomes, and the asymmetry is the heart of the policy: we cannot
        serve what does not exist, we can serve what we doubt.

        Raises:
            ServeRefused: if the model did not fill in `submit_result`, twice in
                a row. The attempt then dies — a transcript where the tool
                returns the server's prose is worse than a missing attempt.
        """
        key = result_key(tool.name, arguments)
        state = state_key(journal)
        cached = read_tool_result(
            supabase, run_id, scenario_index, tool.name, key, state
        )
        if cached is not None:
            return ToolAnswer(*cached)

        world = world_for(config, scenario_index)
        journal_rows = [entry.model_dump() for entry in journal]
        previous_fault = ""
        for attempt in (1, 2):
            try:
                served = await serve(
                    model=get_model(config.models.world, **(model_args or {})),
                    world=config.world,
                    scenario_world=config.scenarios[scenario_index].world,
                    journal=journal,
                    tool=tool,
                    arguments=arguments,
                    fault=previous_fault,
                )
            except ServeRefused:
                # Nothing to tell it: it did not answer. We ask once more, then
                # the attempt dies.
                if attempt == 2:
                    raise
                continue

            verdict, checker, reason = await run_check(
                world, journal, tool.name, arguments, served.result, served.world_change
            )
            keep = verdict is None or verdict[0] or attempt == 2
            if keep:
                return ToolAnswer(
                    *write_tool_result(
                        supabase,
                        run_id,
                        scenario_index,
                        tool.name,
                        key,
                        state,
                        arguments=arguments,
                        state=journal_rows,
                        result=served.result,
                        reasoning=served.reasoning,
                        world_change=served.world_change,
                        model=config.models.world,
                        check_model=checker,
                        attempts=attempt,
                        faithful=None if verdict is None else verdict[0],
                        fault="" if verdict is None else verdict[1],
                        check_error=reason or None,
                    )
                )
            previous_fault = verdict[1]
        raise AssertionError("unreachable: the second attempt always keeps")

    return serve_tool


def check_served_results(
    supabase: Supabase,
    run_id: str,
    config: EvalRunConfig,
    model_args: dict[str, Any] | None = None,
) -> int:
    """Checks the served results nobody has looked at yet.

    One question, and one only: could this result have come out of this call?
    Not "is the world well written" — that is settled before launching.

    Bears on `tool_results` rows, not on conversations: the work to check is
    exactly `(world, call) → result`, and the cache has already reduced three
    hundred and sixty calls to the sixty-odd distinct results they cover. A
    judge would cost the number of conversations; this costs the number of
    different answers, once each.

    **Never brings the run down.** It comes after everything has been played and
    paid for: a check that failed would lose grades already obtained, for a
    piece of information that can itself be caught up. Unchecked rows keep a
    null `faithful`, and a later pass will pick them up — saying in
    `check_error` why the previous attempt did not get there.

    The promise holds over the whole function, not only over `check()`: reading
    what is left to check, building the checker and writing the verdict can each
    raise — a passing Supabase failure, a `models.world` that no longer names a
    known provider — and none of them must reach the caller, which would finish
    the run in error (see C2/B2: that is exactly what this guard exists to
    avoid).

    Returns:
        How many rows received a verdict.
    """
    # A run with no served tool has no row to check, and therefore no need to
    # ask: the question is settled on the configuration, which is already here,
    # rather than by a round trip at the end of every run.
    if not any(tool.served for tool in config.tools):
        return 0

    try:
        to_check = unchecked_tool_results(supabase, run_id)
    except Exception:
        # Not being able to say what is left to check must not bring the run
        # down either: a later pass will retry this read.
        return 0
    if not to_check:
        return 0

    try:
        model = get_model(check_model_for(config.models.world), **(model_args or {}))
    except Exception:
        # A checker we cannot build — missing key, identifier gone invalid —
        # must not bring the run down either: the rows stay to be checked, and a
        # later pass will pick them up once the provider is fixed.
        return 0

    checked = 0
    for row in to_check:
        index = int(row["scenario_index"])
        # The journal as this row saw it, read back rather than recomputed: its
        # fingerprint is in the key, but a fingerprint cannot be reversed.
        # Without it, this pass would recheck the row against a world that is
        # not the one it served — and would condemn a correct read of an
        # already-modified world.
        journal = [JournalEntry(**entry) for entry in (row.get("state") or [])]
        try:
            faithful, fault = asyncio.run(
                check(
                    model=model,
                    world=world_for(config, index),
                    journal=journal,
                    tool=str(row["tool_name"]),
                    arguments=row.get("arguments") or {},
                    result=str(row.get("result") or ""),
                    world_change=str(row.get("world_change") or ""),
                )
            )
        except Exception as e:
            # A row we could not check stays to be checked — but we now say
            # why. Silent, it looked like calm. It must neither pass for
            # faithful nor bring down the ones after it.
            try:
                write_tool_check_error(
                    supabase,
                    run_id,
                    index,
                    str(row["tool_name"]),
                    str(row["arguments_hash"]),
                    str(row.get("state_hash") or ""),
                    reason=f"{type(e).__name__}: {e}"[:500],
                )
            except Exception:
                # Not being able to say why must never cost more than the
                # failure we were trying to name: this write is itself the line
                # protecting the run from `check_served_results` — letting it
                # raise would carry the exception out of this function,
                # contradicting its promise never to bring the run down, and
                # would lose the run its already-recorded cost (see B2). It is
                # exactly in the case aimed at here — a dead key at the
                # checker's provider, and therefore many failing rows — that
                # this write is most likely to fail in its turn.
                pass
            continue
        try:
            write_tool_verdict(
                supabase,
                run_id,
                index,
                str(row["tool_name"]),
                str(row["arguments_hash"]),
                str(row.get("state_hash") or ""),
                faithful=faithful,
                fault=fault,
            )
        except Exception:
            # Symmetrical with writing the reason just above: writing the
            # verdict can fail as writing the error can fail. The row keeps a
            # null `faithful`, and a later pass will pick it up.
            continue
        checked += 1
    return checked


def catchup_dataset(supabase: Supabase, run_id: str) -> MemoryDataset:
    """The conversations already played that still carry, for at least one live
    judge, a `judge_scores` row pending or in error.

    Replaces `rejudge_dataset` and `awareness_dataset`: the modes they served
    (`rejudge`, which overwrote the user judge's grade before redoing it, and
    `awareness`, which caught up only the awareness judge) disappear in favour
    of a single catch-up mechanism, valid for any judge — see the design,
    docs/superpowers/specs/2026-09-06-juges-multiples.md, section "Le
    rattrapage, généralisé". It does nothing but gather the `pending` and
    `error` score rows and have them filled in, which covers four cases at once:
    a judge added to a finished run, an extended run, a judge that fell over on
    a few cells, an interrupted run.

    `error` counts as much as `pending`: a passing network failure writes an
    `error` row (see `write_judge_score`), and nothing else ever picks it up —
    not this catch-up if it did not target it, not the launch, not adding a
    judge. Excluding it would turn a passing failure into a permanent dead end,
    with no recourse but laying down a second identical judge.
    `write_judge_score` rewrites the row entirely on resume: a judge that falls
    into error again leaves a fresh `error` row, a judge that succeeds erases
    the old message in favour of the grade — never both at once.

    Targets only `status = 'done'` conversations: that is the only guarantee a
    transcript exists to read back — the exact inverse of `pending_samples`,
    which targets conversations not yet played. An `error`/`cancelled`/`running`
    conversation never reached the judge the first time; it is not this catch-up
    that should deal with it, but a resume of the conversation itself.

    A judge unlinked since its score row was created is never called back here:
    a pending or errored row whose `run_judge_id` no longer appears in
    `load_live_run_judges` — the only function allowed to say who is live —
    stays as it is for good. That is deliberate: a deleted judge appears
    nowhere (invariant 5 of the design), not even in what remains to be caught
    up. Nothing will ever fill it in, which is of no consequence: nobody will
    read it either.
    """
    live_judges = load_live_run_judges(supabase, run_id)
    live_by_id = {link["id"]: link for link in live_judges}
    if not live_by_id:
        return MemoryDataset([], name="catchup")

    to_resume = supabase.select(
        JUDGE_SCORES,
        run_id=f"eq.{run_id}",
        status="in.(pending,error)",
        select="run_judge_id,sample_id",
    )
    judges_per_sample: dict[str, list[str]] = {}
    for row in to_resume:
        run_judge_id = str(row["run_judge_id"])
        if run_judge_id not in live_by_id:
            continue
        judges_per_sample.setdefault(str(row["sample_id"]), []).append(run_judge_id)
    if not judges_per_sample:
        return MemoryDataset([], name="catchup")

    ids = sorted(judges_per_sample)
    rows = supabase.select(
        SAMPLES,
        run_id=f"eq.{run_id}",
        status="eq.done",
        id="in.(" + ",".join(ids) + ")",
        select=(
            "id,scenario_index,target_model,repetition,temperature,messages,"
            "usage,turns_done"
        ),
        order="scenario_index,target_model,repetition",
    )
    samples = []
    for index, row in enumerate(rows):
        sample_id = str(row["id"])
        samples.append(
            Sample(
                id=index + 1,
                input=(row.get("messages") or [{}])[0].get("content", ""),
                metadata={
                    "id": sample_id,
                    "scenario_index": int(row["scenario_index"]),
                    "target": row["target_model"],
                    "repetition": int(row["repetition"]),
                    "temperature": row.get("temperature"),
                    "transcript": row.get("messages") or [],
                    "usage": row.get("usage") or {},
                    "turns_done": row.get("turns_done") or 0,
                    "judges": [
                        judge_metadata(live_by_id[run_judge_id])
                        for run_judge_id in judges_per_sample.get(sample_id, [])
                    ],
                },
            )
        )
    return MemoryDataset(samples, name="catchup")


@solver
def stored_transcript() -> Solver:
    """A solver with no effect: the transcript is already in the metadata.

    Inspect requires a solver. This one does nothing, deliberately — calling
    anything here would replay the conversation, which is precisely what a
    catch-up must not do.
    """

    async def solve(state: TaskState, generate: Generate) -> TaskState:
        return state

    return solve


def run_batch_job(
    run_id: str,
    mode: str = "run",
    supabase: Supabase | None = None,
    logs_dir: Path = LOGS_DIR,
    model_args: dict[str, Any] | None = None,
    cancellation: Cancellation | None = None,
    storage: Storage | None = None,
) -> None:
    """Runs a run, or catches its judges up, writing each cell as it goes.

    Args:
        run_id: The run to execute, already in the database with its samples.
        mode: `run` plays the conversations and then has them graded by every
            live judge of the run. `catchup` fills in, for conversations already
            played, the `judge_scores` rows still pending — whether a judge was
            added after the fact, the run was extended, a judge fell over on a
            few cells, or the run was interrupted. It is the only catch-up mode
            now: the old `rejudge` mode (which overwrote the user judge's grade
            before redoing it) and `awareness` mode (which caught up only the
            awareness judge) disappeared in its favour — see
            docs/superpowers/specs/2026-09-06-juges-multiples.md.
        supabase: Injectable for the tests, which then need neither network nor
            database.
        cancellation: Injectable for the tests, which must be able to defeat its
            cache. That cache is one second in production — short against the
            length of a model call, long against that of a test.
        logs_dir: Where inspect writes its `.eval` files. The disk is ephemeral
            in a container: the `finally` uploads them to Storage before it
            disappears.
        storage: Injectable for the tests, which then have neither network nor
            bucket.
        model_args: Arguments passed to the models. Used by the tests, with
            `mockllm` — see `conversation_solver.model_args`'s docstring
            (`eval_task.py`).

    Raises:
        ValueError: if `mode` is neither `run` nor `catchup`.
        Any other exception encountered is recorded on the run with status
        `error`, then re-raised.
    """
    if mode not in ("run", "catchup"):
        raise ValueError(f"Unknown job mode: {mode!r}. Expected 'run' or 'catchup'.")

    supabase = supabase or Supabase.from_env()
    row = fetch_run(supabase, run_id)
    config = EvalRunConfig(**row["config"])

    start_run(supabase, run_id, execution=os.environ.get("CLOUD_RUN_EXECUTION"))
    stop = cancellation or Cancellation(supabase, run_id)

    def starting(state) -> None:
        """The cell is starting: say so, or the progress lies.

        A cell in flight read as "to do", and the total of remaining cells
        counted conversations already being written."""
        metadata = state.metadata or {}
        mark_sample_running(
            supabase,
            run_id,
            int(metadata.get("scenario_index", 0)),
            str(metadata.get("target") or ""),
            int(metadata.get("repetition", 0)),
        )

    # What a cell already carried, before this pass — empty for the vast
    # majority of cells, which have never been played. Filled in just before
    # `inspect_eval`, in the branch that builds `dataset` (see below): it is the
    # same metadata `pending_dataset`/`catchup_dataset` has just carried up to
    # the scorer, read here for the merge rather than for the conversation.
    already_billed: dict[tuple[int, str, int], dict[str, dict[str, int]]] = {}

    def write_judge(sample_id: str, outcome: JudgeOutcome) -> None:
        """Each judge writes its own row, as soon as it has given its verdict.

        Called by `judges_scorer` (scoring.py) immediately after each judge,
        before moving to the next — see `judge_conversation`'s docstring for
        invariant 2 (a cancellation does not lose a grade already obtained): it
        is that immediacy which carries it, not an `except BaseException` guard
        copied here. Invariant 1 (one judge failing never costs another its
        grade) also holds from this side: each call aims at a distinct row
        (`run_judge_id`, `sample_id`), never a shared one.
        """
        write_judge_score(
            supabase,
            outcome.run_judge_id,
            sample_id,
            score=outcome.score,
            justification=outcome.justification,
            error=outcome.error,
        )

    def record(sample: ScoredSample) -> None:
        """Finishes the cell, once all its judges have been called: its
        transcript, its depth, its total consumption.

        Writes directly with `Supabase.update` and `sample_filters`, without
        going through a dedicated function in `supabase_store.py`: the grade and
        its justification now live in `judge_scores`, one row per judge, written
        by `write_judge` above — this cell therefore has only a status, a
        transcript and a consumption left to record. The old `write_sample`
        (`supabase_store.py`) wrote all of that at once, grade included, into
        `eval_samples.score` and `.justification`; those two columns disappeared
        with migration `20260906093000_drop_eval_samples_score_columns.sql`, and
        the function with them — see the clear-out done in `supabase_store.py`.
        """
        key = (sample.scenario_index, sample.target, sample.repetition)
        usage = add_usage(already_billed.get(key, {}), sample.usage)
        # Recomputed on the merged consumption, rather than by adding two
        # already-rounded costs: the price is linear in tokens, so the two come
        # to the same when everything is priced, and this shape makes the
        # distinction with a fresh cell — whose "already there" consumption is
        # empty — free. See `pending_dataset`.
        cost, unpriced = actual_cost_from_dicts(usage)
        supabase.update(
            SAMPLES,
            {
                "status": "done",
                # The cell has just been pushed that far: `config.turns` is
                # always what it really carries once finished — including when
                # only a judge, further on, failed. On catch-up, by contrast, no
                # turn has been replayed: see `record_catchup`, which does not
                # touch this field.
                "turns_done": config.turns,
                "messages": sample.messages,
                "temperature": sample.temperature,
                "usage": usage,
                # A total missing a model with no known price would be more
                # misleading than no total at all.
                "cost_usd": None if unpriced else cost,
                "error": None,
                "finished_at": NOW,
            },
            **sample_filters(run_id, *key),
        )

    def record_catchup(sample: ScoredSample) -> None:
        """The same cell, but on catch-up: neither its transcript nor its depth
        has changed — the conversation was not replayed, see
        `stored_transcript` — only its consumption has grown by the cost of the
        judges just called.

        A deliberately narrow write, for the reason that already shaped the old
        `write_awareness`: touching `status`, `messages` or `turns_done` here
        would destroy what we came to complete on an already-good cell.
        """
        key = (sample.scenario_index, sample.target, sample.repetition)
        usage = add_usage(already_billed.get(key, {}), sample.usage)
        cost, unpriced = actual_cost_from_dicts(usage)
        supabase.update(
            SAMPLES,
            {"usage": usage, "cost_usd": None if unpriced else cost},
            **sample_filters(run_id, *key),
        )

    try:
        if mode == "catchup":
            dataset = catchup_dataset(supabase, run_id)
            task_solver: Solver = stored_transcript()
            # Read back from the metadata `catchup_dataset` has just laid down,
            # rather than asked of the database again: it is the same read,
            # there is no need to redo it. A cell on catch-up has already been
            # played once — without this read, `record_catchup` would see only
            # the pass of judges just called and would erase the whole spend of
            # the conversation.
            already_billed = {
                (m["scenario_index"], m["target"], m["repetition"]): (
                    m.get("usage") or {}
                )
                for m in (sample.metadata for sample in dataset.samples)
            }
            # The depth (`turns_done`) does not need reading back here:
            # `record_catchup` never writes it — see its docstring. No turn was
            # replayed, so nothing changed on that front, and the write stays
            # deliberately narrow.
        else:
            # What is left to do, and nothing else: a run whose errors are being
            # replayed, or to which scenarios are being added, must not pay
            # again for its already-graded cells.
            pending_rows = pending_samples(supabase, run_id)
            dataset = pending_dataset(pending_rows, config)
            # Read back from the metadata `pending_dataset` has just laid down,
            # rather than asked of the database again: it is the same read,
            # there is no need to redo it.
            already_billed = {
                (m["scenario_index"], m["target"], m["repetition"]): (
                    m.get("usage") or {}
                )
                for m in (sample.metadata for sample in dataset.samples)
            }

        if len(dataset) == 0:
            # Nothing to do: an already-complete run being relaunched, a
            # catch-up whose rows were filled in meanwhile, or a resume whose
            # cells have been handled. Finishing it cleanly beats letting
            # inspect trip over an empty dataset, and the run would otherwise
            # stay `triggered` until the two-hour sweep.
            usage = row.get("usage") or {}
            cost, unpriced = actual_cost_from_dicts(usage)
            finish_run(
                supabase,
                run_id,
                usage=usage,
                cost_usd=None if unpriced else cost,
            )
            return

        if mode == "run":
            # Every live judge has, by construction, a pending row on any
            # cell that has never been played (see `judgesForLaunch`,
            # web/lib/launch-judges.ts, and extending a run, both of which must
            # create the rows of every live judge for each conversation): no
            # need to query `judge_scores` here, unlike `catchup_dataset`, which
            # has to know precisely which ones remain pending on conversations
            # already played.
            live_judges = load_live_run_judges(supabase, run_id)
            judges_meta = [judge_metadata(link) for link in live_judges]
            for source, sample in zip(pending_rows, dataset.samples):
                sample.metadata["id"] = str(source["id"])
                sample.metadata["judges"] = judges_meta
            task_solver = conversation_solver(
                config,
                model_args=model_args,
                stopped=stop.stopped,
                started=starting,
                serve_tool=world_server(supabase, run_id, config, model_args),
            )

        logs = inspect_eval(
            Task(
                dataset=dataset,
                solver=task_solver,
                scorer=judges_scorer(
                    config,
                    on_judged=write_judge,
                    on_scored=record if mode == "run" else record_catchup,
                    model_args=model_args,
                    stopped=stop.stopped,
                ),
                # One failed repetition must not abort the run: the others carry
                # the frequency information, which is the point of the product.
                fail_on_error=False,
            ),
            # The solver builds each sample's model itself; this nominal model
            # is never called on, but inspect requires one.
            model=config.models.judge,
            model_args=model_args or {},
            log_dir=str(logs_dir / run_id),
            display="none",
        )
        log = logs[0]

        # The stop is read back from the database rather than from the cache:
        # between the last check and here, the user may have clicked.
        cancelled = stop.stopped() or run_status(supabase, run_id) == "cancelled"

        if cancelled:
            # What we decided not to do is not what broke.
            cancel_unfinished_samples(supabase, run_id)
        else:
            # A sample whose solver failed never reaches the scorer, and
            # therefore never `record`. Without this sweep it would stay "to do"
            # on a run that is nonetheless finished. No effect on catch-up: no
            # cell is `pending`/`running` there, see `catchup_dataset`.
            abandon_unfinished_samples(
                supabase, run_id, "The run finished without producing this cell."
            )
            # The environment check, once the conversations are played.
            # Afterwards, never in the hot path: a bad result already served
            # cannot be taken back — what is needed is to know about it, in
            # order to decide whether to keep the run. See
            # docs/superpowers/specs/2026-09-07-le-monde-des-outils.md.
            check_served_results(supabase, run_id, config, model_args)

        # The run's total comes from inspect's log, not from the sum of the
        # cells. The two almost always coincide — verified to zero tokens on a
        # run of 72 cells and three models — but a cell whose conversation
        # failed before reaching the judge never writes its consumption, even
        # though it was billed. The log's total sees it, the sum of the cells
        # does not. The run's figure is what is paid; the cells' says where it
        # went.
        usage = add_usage(row.get("usage") or {}, usage_from_log(log))
        cost, unpriced = actual_cost_from_dicts(usage)

        # Inspect does not raise on a task error: it catches it and finishes
        # the log with a status. Without this check, a broken run would write
        # itself `done` with no error message.
        run_error = None
        if log.status != "success" and not cancelled:
            run_error = (
                log.error.message
                if log.error
                else f"inspect finished with status {log.status!r} and no message."
            )

        finish_run(
            supabase,
            run_id,
            usage=usage,
            # A total missing a model with no known price would be more
            # misleading than no total at all.
            cost_usd=None if unpriced else cost,
            error=run_error,
            cancelled=cancelled,
        )

    except Exception as error:
        abandon_unfinished_samples(
            supabase, run_id, f"{type(error).__name__}: {error}"
        )
        finish_run(supabase, run_id, error=f"{type(error).__name__}: {error}")
        traceback.print_exc()
        raise

    finally:
        # Inspect writes its `.eval` as it goes: a job that dies leaves a
        # partial one, precisely the case where we want to read it. Hence the
        # `finally` rather than the end of the happy path — it also catches the
        # early return on cancellation and the `raise` above. `upload_logs`
        # never raises: a graded run is a successful run, even without its log.
        upload_logs(run_id, logs_dir, storage)


def actual_cost_from_dicts(usage: dict[str, Any]) -> tuple[float, list[str]]:
    """Real cost from consumption as it lives in the database, as JSON."""
    from playground.eval_schemas import ModelUsage

    return actual_cost(
        {model: ModelUsage(**counts) for model, counts in usage.items()}
    )


def main() -> None:
    """The job's entry point."""
    run_id = os.environ.get("EVAL_RUN_ID")
    if not run_id:
        print("EVAL_RUN_ID is required.", file=sys.stderr)
        raise SystemExit(2)
    run_batch_job(run_id, mode=os.environ.get("EVAL_JOB_MODE", "run"))


if __name__ == "__main__":
    main()
