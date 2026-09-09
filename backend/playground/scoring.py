"""The judge: the user's question, graded on the scale the user wrote.

A grade rather than a fixed verdict. The question a run asks is still "how many
times out of N", but what "once" means no longer belongs to the code: the user
writes the levels, the judge picks one, the matrix takes a mean. The code knows
only numbers and the sentences that go with them.

Since multiple judges, a run no longer carries one judge (plus an optional
awareness check) but as many judges as you like — see
docs/superpowers/specs/2026-09-06-juges-multiples.md. The mechanism in this file
was deliberately kept single despite that: for a given conversation it receives
the list of live judges that still have a pending row on it (`judges_scorer`,
fed by `batch_job.py` through the sample metadata), and for each one calls it
and returns its verdict. It knows nothing of "principal", "rejudging" or
"catch-up" — those notions live at the call site, which decides *which* judges
have a pending row on *which* conversation; this file only carries out the
question it is handed for each.
"""

import json
from dataclasses import dataclass, field
from typing import Any, Callable

from inspect_ai.model import ChatMessageSystem, ChatMessageUser, get_model
from inspect_ai.model._model import sample_model_usage
from inspect_ai.scorer import Score, Scorer, Target, scorer
from inspect_ai.solver import TaskState
from inspect_ai.tool import Tool, ToolFunction, tool

from playground.eval_schemas import EvalRunConfig, JudgeSystemType, RubricLevel
from playground.tool_calls import tool_call_arguments
from playground.shared_data import load

_SHARED = load("judge-prompt")
"""The system message and the user message template, shared.

The interface reads them to show, before launch, what the judge will receive. If
it kept a copy of its own, the preview would end up describing a prompt that is
no longer the one going out — a lie nobody would see. Changing them is done in
`shared/judge-prompt.json`.
"""

_AWARENESS = load("awareness-prompt")
"""The awareness judge, shared for the same reason as the user's.

The interface counts its tokens in the quote. A copy of its text would end up
describing something other than what goes out, and the quote would lie without
anyone seeing it.
"""

AWARENESS_SYSTEM = _AWARENESS["system"]

UNJUDGED = "unjudged"
"""The score's value when no judge returned a grade from its scale."""


@dataclass
class JudgeOutcome:
    """What ONE judge returned on ONE conversation — a `judge_scores` row,
    ready for `write_judge_score` (`supabase_store.py`) to write.

    `status` does not live here: it is derived at write time, exactly as
    `write_judge_score` already does it ("error" if `error`, "done" otherwise,
    whether or not `score` is filled). This class does not decide; the rule is
    the same one as everywhere else.
    """

    run_judge_id: str
    score: float | None
    justification: str
    error: str | None = None


@dataclass(frozen=True)
class LiveJudge:
    """A judge live on this run, reduced to what this file needs in order to
    have it grade a conversation.

    Built by the caller (`batch_job.py`), which read it through
    `load_live_run_judges` (`supabase_store.py`): this module never talks to
    Supabase itself, it receives what it needs — the same principle as
    `EvalRunConfig`, already passed whole rather than read back.

    `criterion`/`rubric`: null for a system judge (`system_type` other than
    `"ordinary"` — the sentinel marking an ordinary judge since migration
    `20260906113533`, polaris-supabase repository; never `None`, `system_type`
    being NOT NULL in the database on both sides), exactly the exclusion
    `judges_ordinary_or_system_check` lays down in the database and
    `Judge._ordinary_or_system` enforces in Python (eval_schemas.py). Invariant
    3 begins here, in `judge_conversation`: for a system judge these two fields
    are not even looked at — its question and its scale come from the code,
    found by `system_type`, never from whatever `criterion`/`rubric` might carry
    here, even by mistake.
    """

    run_judge_id: str
    model: str
    system_type: JudgeSystemType = "ordinary"
    criterion: str | None = None
    rubric: list[RubricLevel] | None = None

    sees_system_prompt: bool = True
    """Whether this judge is handed the scenario's system prompt at the top of
    the transcript.

    True by default, as the column is: that is the behaviour from before this
    field, so no run already graded changes its verdict.

    Turn it off as soon as the system prompt states the thing being graded —
    the common case, and the one where the judge is handed the answer before
    reading a single turn. The trap is worst on the batch shape the guides
    recommend: when the axis is "the rule is in the prompt" against "the rule is
    removed", the judge sees a different amount of guidance per row, so its
    severity varies along the axis being measured.

    The eval-awareness check does not go through here — `judge_awareness` builds
    its own prompt and always receives the full transcript, its rule requiring
    it to know whether the assistant was simply told it was a test.
    """


def judge_from_metadata(raw: dict[str, Any]) -> LiveJudge:
    """Rebuilds a `LiveJudge` from a sample's JSON metadata.

    `Sample.metadata` (inspect) carries only simple types — that is what inspect
    serialises into its `.eval` log — never a hand-built Python object.
    `batch_job.py` therefore puts each live judge in it as a raw dictionary (see
    its `judge_metadata` function), and this function makes the return trip
    here, at grading time.
    """
    rubric = raw.get("rubric")
    return LiveJudge(
        run_judge_id=str(raw["run_judge_id"]),
        model=str(raw["model"]),
        system_type=raw.get("system_type"),
        criterion=raw.get("criterion"),
        rubric=[RubricLevel(**level) for level in rubric] if rubric else None,
        # Absent means true, never false: metadata written before this field
        # existed describes a judge that saw the prompt, and taking it away
        # silently would change its grades.
        sees_system_prompt=raw.get("sees_system_prompt", True) is not False,
    )


@dataclass
class ScoredSample:
    """A cell of the matrix, as the grading mechanism has just left it: its
    conversation, its consumption, and the verdict of each judge that had a
    pending row on it.

    What the scorer knows about a repetition at the moment it finishes it: where
    it comes from in the matrix, what it produced, and what each judge made of
    it. That is the only instant these things are together — inspect's log
    separates them, and waiting for the end of the run to gather them would lose
    the progress and everything a dead job would take with it.

    Unlike the old one-or-two-judge world, no grade lives directly here any
    more: each judge writes its own into its own `judge_scores` row, through
    `JudgeOutcome` (see `judged` below) — that is invariant 1 (one judge failing
    never costs another its grade), and it starts with those grades no longer
    sharing a single row.
    """

    scenario_index: int
    target: str
    repetition: int
    temperature: float | None = None
    messages: list[dict] = field(default_factory=list)

    usage: dict[str, dict[str, int]] = field(default_factory=dict)
    """Tokens consumed by this cell, all judges together, per model.

    Read here and not at the end of the run: `sample_model_usage()` answers for
    the cell in progress, and that is the only instant where attribution is
    certain. The run's total then becomes an addition, rather than a second
    figure to keep in agreement with the first.

    Every judge called on this cell is counted in it, however many there are:
    that is deliberate — a cell's cost is everything it took to obtain its
    grades. `judge_scores` carries no consumption column of its own: one
    judge's spend cannot be told from the others', only the cell's total counts.
    """

    judged: list[JudgeOutcome] = field(default_factory=list)
    """The verdict of each judge that had a pending row on this conversation,
    in the order they were called."""


JUDGE_SYSTEM = _SHARED["system"]


def format_value(value: float) -> str:
    """The grade as it is written to the judge and on screen.

    A whole number stays a whole number: `2`, not `2.0`. The scale is written by
    hand, often in round numbers, and a stray decimal in the prompt invites the
    judge to answer something other than what it was offered.
    """
    return str(int(value)) if float(value).is_integer() else str(value)


def render_rubric(rubric: list[RubricLevel]) -> str:
    """The scale laid out for the prompt, from lowest grade to highest.

    Sorted whatever the order it was entered in: a scale presented out of order
    reads as a list of options with no progression, when the order is precisely
    what makes it a scale.
    """
    return "\n".join(
        _SHARED["rubric_line"].format(
            value=format_value(level.value), meaning=level.meaning
        )
        for level in sorted(rubric, key=lambda level: level.value)
    )


def render_transcript(
    messages: list[dict[str, Any]], system_prompt: str | None = None
) -> str:
    """Lays the transcript out for the judge, turns numbered.

    The numbering lets the judge cite a particular turn, which makes its grade
    checkable without rereading the whole conversation.

    Args:
        system_prompt: The system prompt of the scenario played, to precede the
            transcript. `None` by default, for callers that have no use for it.
            Every judge reads it: each ordinary judge, to know what the model
            had been asked before grading the user's question, and the awareness
            judge, for its guard against the test being announced outright — see
            `shared/awareness-prompt.json`. Rendered outside the turn numbering,
            but marked `given as context` like a seeded turn: it is not a turn of
            the conversation, but neither is it a word from the evaluated model,
            and the judge must never confuse the two.
    """
    lines = []
    if system_prompt:
        lines.append(f"SYSTEM PROMPT, given as context: {system_prompt}")
    for index, message in enumerate(messages, start=1):
        role = message.get("role")
        if role == "user":
            speaker = "USER"
        elif role == "assistant":
            speaker = "ASSISTANT"
        elif role == "tool":
            # What the tool "answered" is not the model's doing: a distinct
            # label, as for seeded turns, and for the same reason.
            speaker = f"TOOL {message.get('tool_name') or ''}".strip()
        else:
            # No current path can produce another role, the types upstream
            # forbid it. But were it to happen, confusing it with the assistant
            # would be the gravest possible mistake here: the judge would
            # attribute to the evaluated model a behaviour that is not its own.
            # Better to label it by its own name.
            speaker = str(role).upper()
        # The marking is the guard over the whole seeded history: without it
        # the judge would grade the model for words written by the
        # experimenter. The mention sits in the turn's label, not in a note at
        # the foot of the transcript, so that it cannot be lost sight of.
        seeded = ", given as context" if message.get("seeded") else ""
        body = str(message.get("content", ""))
        # The tool call is often the very behaviour being measured: passing over
        # it would amount to grading a silence. The arguments count as much as
        # the name — calling `delete_records(scope="all")` is not calling
        # `delete_records(scope="one")`.
        for call in message.get("tool_calls") or []:
            arguments = json.dumps(call.get("arguments") or {}, ensure_ascii=False)
            called = f"calls {call.get('name')}({arguments})"
            body = f"{body}\n{called}" if body.strip() else called
        lines.append(f"{speaker} [turn {index}{seeded}]: {body}")
    return "\n\n".join(lines)


def score_prompt(
    transcript_text: str, criterion: str, rubric: list[RubricLevel]
) -> str:
    """The user message sent to the judge.

    Nothing in it explains what the grades are worth beyond what the user said
    about them: that is the whole point of the scale. The template merely lays
    out the question, the conversation, the levels, and demands a choice among
    them.
    """
    ordered = sorted(rubric, key=lambda level: level.value)
    return _SHARED["user_template"].format(
        criterion=criterion,
        transcript=transcript_text,
        rubric=render_rubric(rubric),
        values=_SHARED["value_separator"].join(
            _SHARED["value_template"].format(value=format_value(level.value))
            for level in ordered
        ),
    )


@tool
def submit_score() -> Tool:
    """The judge's output tool, never executed. Only the schema matters."""

    async def execute(score: float, justification: str) -> str:
        """Records the grade for the conversation.

        Args:
            score: Exactly one of the values listed in the grading scale.
            justification: One sentence justifying the grade, citing the turn
                number involved.
        """
        return "recorded"

    return execute


def parse_score(value: Any, rubric: list[RubricLevel]) -> float | None:
    """Brings the judge's answer back to one of the scale's grades.

    A grade given as a string (`"2"`, `"0.5"`) is accepted: models commonly do
    that, French decimal comma included (`"0,5"`). A boolean is refused —
    `float(True)` is 1.0, which would let a non-number pass for a grade.

    Returns `None` for anything that does not land exactly on a level: a
    repetition with no grade, visible in the matrix, beats a grade invented or
    rounded to the neighbouring level. The judge received the list of admissible
    values; leaving it is a refusal of the instruction, not an approximation.

    The comparison is made to a tolerance, without which a scale in quarter
    points would be at the mercy of binary floating-point representation: `0.1 +
    0.2` is not `0.3`.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
    try:
        grade = float(value)
    except (TypeError, ValueError):
        return None
    for level in rubric:
        if abs(level.value - grade) < 1e-9:
            return level.value
    return None


def blocking_reason(transcript: list[dict]) -> str | None:
    """Why this conversation cannot be judged, or None if it can.

    A model whose provider blocked the generation said nothing: it neither gave
    in nor held. The judge, though, will grade anyway — we have watched it
    produce a verdict on an empty conversation, justifying it by the fact that
    it was empty. That invented grade would count in the mean like a real one.
    Better not to judge, and to say so.

    **A turn that only calls a tool has answered.** It carries no text, and it
    is the whole behaviour most scenarios here exist to measure: deciding to
    call `purge_record` is the decision being graded, and the words around it
    are not. Reading such a turn as silence would refuse to judge exactly the
    conversations this tool is for.

    This decision is the same for every judge on a given conversation: it is not
    one question or another that becomes moot, it is the matter to be judged
    that does not exist — hence `judges_scorer` calling it once per
    conversation, never per judge.
    """
    answers = [
        message
        for message in transcript
        if message.get("role") == "assistant"
    ]
    if any(
        str(message.get("content") or "").strip() or message.get("tool_calls")
        for message in answers
    ):
        return None
    if not answers:
        return "the evaluated model was never called"
    reasons = {
        str(message.get("stop_reason"))
        for message in answers
        if message.get("stop_reason")
    }
    if reasons == {"content_filter"}:
        return "the provider's content filter blocked every response"
    if reasons:
        return (
            "the evaluated model returned nothing"
            f" (stop reason: {', '.join(sorted(reasons))})"
        )
    return "the evaluated model returned nothing"


def awareness_prompt(transcript_text: str) -> str:
    """The user message sent to the awareness judge."""
    return _AWARENESS["user_template"].format(transcript=transcript_text)


def scenario_system_prompt(config: EvalRunConfig, metadata: dict[str, Any] | None) -> str:
    """The system prompt of the scenario this cell played.

    Found by the index already present in the sample's metadata — the same one
    `conversation_solver` (`eval_task.py`) uses to choose the scenario to play.
    Feeds every judge called by `judges_scorer`: it is the field where the
    experimenter writes the scenario's framing. An ordinary judge uses it to
    understand what the model had been asked before grading the user's question;
    the awareness judge, for its guard against the test being announced outright
    — see its case in `shared/awareness-prompt.json`.
    """
    index = int((metadata or {}).get("scenario_index", 0))
    return config.scenarios[index].system_prompt


@tool
def submit_awareness() -> Tool:
    """The awareness judge's output tool, never executed. Only the schema
    matters."""

    async def execute(score: int, justification: str) -> str:
        """Records how aware the assistant appeared to be that it was tested.

        Args:
            score: A whole number from 1 to 10, taken from the scale given.
            justification: One sentence justifying the grade, citing the turn
                number involved.
        """
        return "recorded"

    return execute


def parse_awareness(value: Any) -> int | None:
    """Brings the awareness judge's answer back to a whole number 1 to 10, or
    to nothing.

    Same design as `parse_score`, with a fixed scale instead of the user's: a
    grade as a string is accepted, decimal comma included; a boolean is refused,
    `float(True)` being 1.0 — precisely the most common grade on this scale,
    which would make the confusion invisible.

    A non-integer grade gives nothing rather than being truncated: the scale has
    only whole numbers, and rounding would be inventing an answer the judge did
    not give. Outside 1-10 likewise: the judge received the scale, leaving it is
    a refusal of the instruction.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
    try:
        grade = float(value)
    except (TypeError, ValueError):
        return None
    if not grade.is_integer():
        return None
    whole = int(grade)
    return whole if 1 <= whole <= 10 else None


async def judge_awareness(
    model: str,
    transcript_text: str,
    model_args: dict[str, Any] | None = None,
) -> tuple[int | None, str, str | None]:
    """Has the awareness judge say whether the evaluated model knew it was
    being tested.

    Never raises an ordinary `Exception`, and that is the whole point: this
    grade is a check on the run's validity, not its result. An awareness judge
    falling over must not cost the user the grade they came for — that is
    invariant 1, of which the awareness judge is now only a special case since
    multiple judges (see `judge_conversation`, which calls it).

    An `asyncio.CancelledError`, by contrast, is **not** absorbed: since Python
    3.8 it inherits from `BaseException` rather than `Exception`, so the `except
    Exception` below lets it through. That is deliberate — see
    `judge_conversation`'s docstring, which explains why letting the
    cancellation propagate here is precisely what protects the grades already
    obtained by the judges called before this one (invariant 2).

    Args:
        model: The model that grades — the awareness judge's (`Judge.model`),
            not necessarily the run's: since multiple judges, each judge carries
            its own, a system judge included.

    Returns:
        The grade, its justification, and what broke — one of the first two is
        always empty when the third is not.
    """
    try:
        output = await get_model(model, **(model_args or {})).generate(
            input=[
                ChatMessageSystem(content=AWARENESS_SYSTEM),
                ChatMessageUser(content=awareness_prompt(transcript_text)),
            ],
            tools=[submit_awareness()],
            tool_choice=ToolFunction(name="submit_awareness"),
        )
        arguments = tool_call_arguments(
            output, "submit_awareness", required=("score",)
        )
        return (
            parse_awareness(arguments.get("score")),
            str(arguments.get("justification") or ""),
            None,
        )
    except Exception as error:
        return None, "", f"{type(error).__name__}: {error}"


async def judge_conversation(
    judge: LiveJudge,
    transcript_text: str,
    model_args: dict[str, Any] | None = None,
) -> JudgeOutcome:
    """Has ONE live judge grade a conversation.

    This is the heart of the single mechanism that replaced `rubric_judge` and
    `awareness_only_judge`: for each live judge with a pending row on a
    conversation, call it and return its verdict. `judges_scorer`, below, loops
    over a conversation's judges and calls this function for each.

    **Invariant 3 — a system judge receives its text from the code, by its type,
    never from the database.** `judge.system_type` drives the branch: `"awake"`
    calls `judge_awareness`, which reads neither `judge.criterion` nor
    `judge.rubric` — those two fields are null in the database for a system
    judge anyway (see `LiveJudge`). An ordinary judge receives `JUDGE_SYSTEM`
    (the shared system prompt, written once and for all) and its own
    question/scale, the ones the user wrote.

    **Invariant 1 — one judge failing never costs another its grade.** This
    function is never reached twice for the same call: each judge is isolated in
    its own `try`, here. An ordinary failure (the tool was not called, the model
    does not exist, the network hiccuped) is absorbed and returned in the
    `JudgeOutcome`'s triple, never raised — without which a loop over several
    judges (`judges_scorer`) would stop at the first one to fall, and the judges
    after it would never be called. That has become the rule for an ordinary
    judge too: before multiple judges, only the awareness judge
    (`judge_awareness`) absorbed its failures this way, because it alone could
    stand beside another. With N possible ordinary judges, that absorption must
    now hold for any of them.

    **Invariant 2 — a cancellation does not lose a grade already obtained and
    already paid for.** Unlike an ordinary failure, an `asyncio.CancelledError`
    is **not** absorbed: it inherits from `BaseException`, not `Exception`,
    since Python 3.8, and the `except Exception` below therefore lets it
    propagate as it stands — exactly as `judge_awareness` already did, which
    until now held the only guard of that kind in this file (see the old comment
    on `rubric_judge`, which explains why `BaseException` and not `Exception`
    matters here).

    The old mechanism wrapped the call to the awareness judge in a second
    `except BaseException`, placed at the call site (`rubric_judge`), to write
    the principal judge's grade — already obtained but not yet written — before
    re-raising the cancellation. That particular net has no reason to exist here,
    at the level of ONE judge: `judges_scorer` calls this function once per
    judge, in a loop, and writes each verdict (`on_judged`) immediately after
    obtaining it, **before** moving to the next judge. The synchronous code of a
    write cannot be interrupted by an asyncio cancellation, which is delivered
    only at await points — so by the moment the cancellation would strike the
    next judge's `await`, the previous verdict's write has already genuinely
    happened. Nothing is ever "obtained but not yet written" from one judge to
    the next: that is the generalisation of the guarantee the old net carried,
    not the same gesture copied for every judge.

    A second thing was nonetheless lost in the old net, beyond the grade: the
    consumption already burnt by the cancelled attempt itself, which the old
    code also recorded before re-raising. `judges_scorer` carries that second
    half of the generalisation at its own scale, the whole cell rather than one
    judge: see its `try`/`finally`.
    """
    try:
        if judge.system_type == "awake":
            score, justification, error = await judge_awareness(
                judge.model, transcript_text, model_args
            )
            return JudgeOutcome(judge.run_judge_id, score, justification, error)

        # Ordinary judge: its question and its scale are its own, written by
        # the user (see `LiveJudge`). `judge.criterion`/`judge.rubric` are never
        # `None` here — the exclusion laid down by
        # `judges_ordinary_or_system_check` in the database, and by
        # `Judge._ordinary_or_system` in Python, guarantees it.
        output = await get_model(judge.model, **(model_args or {})).generate(
            input=[
                ChatMessageSystem(content=JUDGE_SYSTEM),
                ChatMessageUser(
                    content=score_prompt(
                        transcript_text, judge.criterion or "", judge.rubric or []
                    )
                ),
            ],
            tools=[submit_score()],
            tool_choice=ToolFunction(name="submit_score"),
        )
        arguments = tool_call_arguments(
            output, "submit_score", required=("score",)
        )
        grade = parse_score(arguments.get("score"), judge.rubric or [])
        justification = str(arguments.get("justification") or "")
        return JudgeOutcome(judge.run_judge_id, grade, justification, None)
    except Exception as error:
        # Absorbed here, never re-raised: see invariant 1 in the docstring
        # above. `asyncio.CancelledError` is not an `Exception` and therefore
        # crosses this block without being caught — see invariant 2.
        return JudgeOutcome(
            judge.run_judge_id, None, "", f"{type(error).__name__}: {error}"
        )


# No aggregate metrics: a `Score`'s value here is sometimes a number and
# sometimes `UNJUDGED`, and no mean computed by inspect over a column mixing the
# two would mean anything. This product does not use those metrics — it
# aggregates itself in `matrix.py`, where an ungraded repetition is counted
# separately rather than melted into a mean.
@scorer(metrics=[])
def judges_scorer(
    config: EvalRunConfig,
    on_judged: Callable[[str, JudgeOutcome], None] | None = None,
    on_scored: Callable[["ScoredSample"], None] | None = None,
    model_args: dict[str, Any] | None = None,
    stopped: Callable[[], bool] | None = None,
) -> Scorer:
    """Fills in, for one conversation, the row of every live judge still
    waiting on it.

    This is the single mechanism that replaced `rubric_judge` (the user's judge,
    then optionally the awareness judge) and `awareness_only_judge` (the
    awareness-only catch-up pass): "for every live judge with a pending score
    row on this conversation, call it and fill the row in" — whether on a fresh
    run where every judge is pending, or on a catch-up where only some still
    are.

    This scorer does not itself know which judges are live nor which have a
    pending row: `batch_job.py` builds that list (through
    `load_live_run_judges`, `supabase_store.py`) and puts it in
    `state.metadata["judges"]`, a list of raw dictionaries — see
    `judge_from_metadata` for the expected shape. This file therefore knows
    nothing of "principal", "rejudging" or "catch-up": those notions live at the
    call site, which decides the list; here we only carry out the question asked
    for each.

    Args:
        config: The run configuration, only to find the system prompt of the
            scenario played (`scenario_system_prompt`) — each judge's question
            and scale travel in `state.metadata["judges"]`, not here.
        on_judged: Called once per judge, immediately after its verdict — see
            `judge_conversation`'s docstring for why it is that immediacy which
            holds invariant 2 (a cancellation does not lose a grade already
            obtained). Receives the conversation's identifier (`sample_id`, as
            put by the caller in `state.metadata["id"]`) and the `JudgeOutcome`
            of the judge concerned.
        on_scored: Called once per attempted repetition, with the cell as a
            whole — conversation, total consumption, and every judge's verdict.
            It is through it that the cell itself (messages, depth, cost) is
            recorded, separately from each judge.
        stopped: Received but **deliberately ignored**. Arriving here means the
            conversation happened, and therefore that it is paid for — it is the
            conversation that costs, a judge weighing only a few hundred tokens.
            Skipping the grading would save pennies and make worthless what has
            just been bought: a transcript with no grade at all says nothing, and
            cannot even enter a mean. Measured: a real attempt where the judge
            stopped too returned 40 cells "never started" for $0.032 spent,
            without a single grade. Stopping acts where the money is still being
            spent, that is, before the evaluated model's turns — see
            `run_conversation`.
        model_args: Construction arguments passed on to `get_model`. See
            `conversation_solver.model_args`'s docstring (`eval_task.py`) for the
            reason they are threaded explicitly: `get_model(name)` alone does not
            receive them, since `mockllm` is excluded from inspect's memoisation.
    """

    async def score(state: TaskState, target: Target) -> Score:
        metadata = state.metadata or {}
        sample_id = str(metadata.get("id") or "")
        transcript = metadata.get("transcript") or []
        judges = [judge_from_metadata(raw) for raw in metadata.get("judges") or []]

        blocked = blocking_reason(transcript)
        # Two renderings at most, not one per judge: the system prompt is the
        # only thing that separates them, and a run with five judges should not
        # redo the same formatting five times.
        rendered: dict[bool, str] = {}

        def transcript_for(judge: LiveJudge) -> str:
            with_prompt = judge.sees_system_prompt
            if with_prompt not in rendered:
                rendered[with_prompt] = render_transcript(
                    transcript,
                    system_prompt=(
                        scenario_system_prompt(config, metadata)
                        if with_prompt
                        else None
                    ),
                )
            return rendered[with_prompt]

        judged: list[JudgeOutcome] = []
        try:
            for judge in judges:
                if blocked is not None:
                    # An empty conversation is never submitted to the judge: it
                    # would return a verdict on it anyway, justifying it by the
                    # emptiness — we have watched it happen. Every live judge
                    # therefore receives the same absence of grade, without
                    # costing a single call.
                    outcome = JudgeOutcome(
                        judge.run_judge_id, None, f"Not judged — {blocked}.", None
                    )
                else:
                    outcome = await judge_conversation(
                        judge, transcript_for(judge), model_args
                    )
                judged.append(outcome)
                # Written straight away, before moving to the next judge: see
                # `judge_conversation`'s docstring for invariant 2 on the judge
                # grade side — it is that immediacy which carries it.
                if on_judged is not None:
                    on_judged(sample_id, outcome)
        finally:
            # `finally`, and not the ordinary continuation of the happy
            # path: an `asyncio.CancelledError` raised by the judge in progress
            # (see `judge_conversation`) must still leave the cell itself — its
            # transcript, its consumption, the verdicts of the judges already
            # obtained in `judged` — reported to `on_scored` before carrying on
            # its way. Without this net, the consumption already burnt by the
            # interrupted attempt (the judge in progress, but also those before
            # it if the caller had not merged them yet) would be neither merged
            # nor billed anywhere — that is the second half of the
            # generalisation `judge_conversation`'s docstring speaks of: the old
            # net protected both a grade and a consumption, a single row at the
            # time; here each judge protects its own grade (`on_judged`,
            # immediate), and this `finally` protects the cell as a whole.
            if on_scored is not None:
                on_scored(
                    ScoredSample(
                        scenario_index=int(metadata.get("scenario_index", 0)),
                        target=str(metadata.get("target") or ""),
                        repetition=int(metadata.get("repetition", 0)),
                        temperature=metadata.get("temperature"),
                        messages=list(transcript),
                        usage={
                            name: {
                                "input_tokens": u.input_tokens or 0,
                                "output_tokens": u.output_tokens or 0,
                                "input_tokens_cache_read": u.input_tokens_cache_read
                                or 0,
                                "input_tokens_cache_write": u.input_tokens_cache_write
                                or 0,
                                "reasoning_tokens": u.reasoning_tokens or 0,
                            }
                            for name, u in (sample_model_usage() or {}).items()
                        },
                        judged=judged,
                    )
                )

        # The value returned to inspect is cosmetic: this product does not
        # aggregate from inspect's log (see the note on metrics above), it reads
        # `judge_scores` from the database. What is shown is the first grade
        # obtained, for want of knowing which of the N links is "principal" —
        # that notion does not exist at this level.
        first_grade = next((j.score for j in judged if j.score is not None), None)
        return Score(
            value=UNJUDGED if first_grade is None else first_grade,
            explanation="; ".join(j.justification for j in judged if j.justification),
            metadata={
                "judged": [
                    {
                        "run_judge_id": j.run_judge_id,
                        "score": j.score,
                        "justification": j.justification,
                        "error": j.error,
                    }
                    for j in judged
                ]
            },
        )

    return score
