"""Pydantic models of the evaluation engine.

Everything the job reads and writes goes through here: a run's configuration,
its cells, its judges and their grades. The corresponding Supabase tables are
described one by one in `web/lib/supabase.ts`, and the migrations live in
`polaris-supabase`.
"""

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

EvalRunStatus = Literal["pending", "running", "done", "error", "cancelled"]


class RubricLevel(BaseModel):
    """One level of the grading scale, as the user writes it.

    `value` is the grade the judge will return, `meaning` the sentence telling
    it what that grade means. The two travel together: a grade without its
    meaning cannot be read back three weeks later, and the judge would not know
    when to choose it.
    """

    value: float
    meaning: str = Field(min_length=1)

    excluded: bool = False
    """Does this level count towards the mean, or stay outside it?

    For saying "the question did not apply": the judge did decide, but the grade
    has no meaning on the scale. Letting it into the mean would pull the cell
    down for a reason that has nothing to do with what is being measured.

    Distinct from a cell with no grade: there, the judge could say nothing. Here
    it said "not applicable", which is an answer.
    """


# --- Multiple judges ---------------------------------------------------------
#
# Three tables in the database, each with its model: `Judge` a judge's
# configuration, `RunJudge` its link to a given run, `JudgeScore` what it found
# on one conversation. See the migration
# `evals/supabase/migrations/20260906092100_create_judges_tables.sql`
# (polaris-supabase repository) and
# docs/superpowers/specs/2026-09-06-juges-multiples.md for the reasoning in
# detail — what follows is only a typed mirror of it.
#
# `JudgeSpec`, at the bottom of this section, is not a mirror of a table: it is
# what a run carries in its configuration, before any row exists.

JudgeSystemType = Literal["ordinary", "awake"]
"""The exact domain of the `system_type` column, in `judges` as in
`run_judges` — that of the `judges_system_type_check` CHECK in the database.

`"ordinary"` is a sentinel, not a system type: it names no system judge, it only
says there is none. The column is NOT NULL on both sides, with no default, since
migration `20260906113533_run_judges_judge_fk_and_system_type_sentinel.sql`
(polaris-supabase repository) — before it, absence (`NULL`) played that role, but
disarmed `run_judges`'s composite foreign key on the way (see
`RunJudge.system_type`). `"awake"`, the awareness check, is the only real system
type today. Others will come without a new migration; they are added here."""


class Judge(BaseModel):
    """A row of `judges`: a judge's configuration, independent of the runs
    that use it — see `RunJudge` for the link to a given run.

    An ordinary judge carries its question and its scale, written by the user:
    `criterion` and `rubric` are then filled in. A system judge (`system_type`
    other than `"ordinary"`) carries only its identity: its question, its scale
    and its prompt live in the code, found by that type — never in the database.
    Putting them there would lose the three guarantees git gives that text: the
    same everywhere, a review when it changes, a history of who changed it — and
    two runs could be graded by two versions of the text without anything saying
    so.

    The two shapes exclude each other: `_ordinary_or_system` enforces that here,
    as the `judges_ordinary_or_system_check` constraint does in the database.
    """

    id: str
    criterion: str | None = None
    """The question put to the judge, as the user wrote it. `None` for a
    system judge — see the class docstring."""

    rubric: list[RubricLevel] | None = None
    """The judge's scale, as the user wrote it. `None` for a system judge —
    see the class docstring."""

    model: str
    """The model that grades."""

    system_type: JudgeSystemType
    """`"ordinary"` for an ordinary judge — a sentinel, never absent: the
    column is NOT NULL in the database with no default, so this field has no
    default here either; every construction of a judge must set it explicitly.
    `"awake"`: the awareness check — did the evaluated model show it knew it was
    being tested? Its question does not belong to the user, its scale is fixed
    from 1 to 10, and its failure never costs the principal judge its grade —
    those three properties live in the code that builds this judge, not here."""

    created_by: str
    """Who created this judge — the session's address, never what the client
    claims."""

    created_at: str

    @model_validator(mode="after")
    def _ordinary_or_system(self) -> "Judge":
        """Mirror of `judges_ordinary_or_system_check`: a system judge carries
        neither criterion nor scale; an ordinary judge carries both.

        "Is this judge a system one?" used to be read by an absence
        (`system_type is None`); since the `"ordinary"` sentinel (migration
        `20260906113533`, polaris-supabase repository) it is read by a value:
        the comparison must stay `!= "ordinary"` / `== "ordinary"`, never `is
        not None` / `is None`. Never go back to a null test to "simplify" —
        `"ordinary"` is not null, such a test would always be false, and every
        judge would silently become a system judge.
        """
        has_criterion = self.criterion is not None
        has_rubric = self.rubric is not None
        if has_criterion != has_rubric:
            raise ValueError(
                "criterion and rubric must be both present or both absent."
            )
        if self.system_type != "ordinary" and has_criterion:
            raise ValueError(
                "A system judge carries no criterion or rubric — its text"
                " lives in the code, retrieved by system_type."
            )
        if self.system_type == "ordinary" and not has_criterion:
            raise ValueError(
                "An ordinary judge (system_type == 'ordinary') must carry a"
                " criterion and a rubric."
            )
        return self


class RunJudge(BaseModel):
    """A row of `run_judges`: this judge, in this run, in this capacity.

    The link exists before a single conversation is graded — at launch, or on
    the day a judge is added to a finished run. `is_principal` and `deleted_at`
    make sense only for this run: putting them on `Judge` would be wrong, since
    the same judge can be principal here and secondary elsewhere.

    The trap in this design, and it is a real one: the "not deleted" filter
    (`deleted_at is None`) must live in a single place, in the function that
    loads a run's judges. Copying it into two reads means forgetting it in a
    third — this work has already produced two instances of that omission.
    """

    id: str
    run_id: str
    judge_id: str

    system_type: JudgeSystemType
    """A copy of `Judge.system_type` at the moment of linking. `"ordinary"`
    for an ordinary link — a sentinel, never absent: NOT NULL in the database on
    both sides, with no default, since migration `20260906113533`
    (polaris-supabase repository); every construction of a link must set it
    explicitly, copied from the `Judge` it points at, never written
    independently of it.

    Pinned by the composite foreign key `(judge_id, system_type) -> judges (id,
    system_type)`, which forbids any divergence between the two copies — and,
    since the same migration, by a second foreign key on `judge_id` alone, which
    on its own guarantees the target judge exists: the composite one did not
    guarantee it while `system_type` could be `NULL` (`MATCH SIMPLE` considers
    it satisfied as soon as one referencing column is null, which was the case
    for nearly every link before the sentinel).

    Exists here only because a partial unique index cannot read a column from
    another table: the invariant "at most one live link of a given
    `system_type` (other than `"ordinary"`) per run" bears on this table, so it
    needs a column of its own."""

    is_principal: bool = False
    """The judge the matrix shows. Two distinct guarantees, in the database,
    compose the "exactly one" the design aims at for any run with at least one
    live link — neither does it alone. The partial unique index
    `run_judges_single_principal_idx` guarantees only **at most one** live
    principal link per run; it says nothing about the absence of a principal. It
    is the deferred trigger `run_judges_require_principal_trg` (migration
    `20260906102248`) that closes the other side, and only for UPDATEs that take
    the principal away from a link that already carried it — an INSERT is never
    covered, see the migration's comment for that accepted gap in scope."""

    deleted_at: str | None = None
    """`None` while the link is live. It is the link that is deleted, never the
    judge: the row stays, marked, so that it is still known this run was graded
    by that one, at some point. The deletion is soft — an UPDATE that sets this
    column, never a DELETE: `judge_scores` does carry an `on delete cascade`
    foreign key towards this link, but nothing ever triggers it in practice, and
    `service_role` is not even allowed to delete a `run_judges` row (only
    `select`, `insert`, `update` are granted to it — migration
    `20260906092100`). The `JudgeScore` rows of an unlinked judge therefore stay
    in the database, unchanged; it is the reading discipline — filtering on
    `deleted_at is null` before reading them — that carries the whole weight of
    no longer showing them, not a deletion that never happens."""

    created_at: str


JudgeScoreStatus = Literal["pending", "done", "error"]
"""The three raw values `JudgeScore.status` carries in the database — the
`judge_scores_status_check` CHECK. They distinguish four situations, not three:
`pending` before the job deals with it; `done` covers both "graded" (`score`
filled in) and "no grade" (empty conversation, or a grade off the scale), told
apart by the nullity of `JudgeScore.score` rather than by a fourth status value;
`error` if the judge fell over, where `score` always stays `None`. It is the
same three-way distinction this product already holds for a cell of the matrix,
with waiting added: four real situations, carried by three column values plus
the nullity of `score`. Do not add a fourth status value for "no grade": the
migration does not carry one, and this file follows the migration."""


class JudgeScore(BaseModel):
    """A row of `judge_scores`: what one judge found on one conversation.

    One row per (link, conversation) — see `run_judge_id` and `sample_id`, whose
    pair is the primary key in the database: a judge gives one grade and one
    only per conversation. That is what makes a resume safe — it rewrites the
    same row instead of stacking duplicates.

    Every row exists from launch, `pending`: the job fills them in, it does not
    create them — exactly as `eval_samples` already does for the matrix itself,
    and for the same strongest reason: it makes "what remains to be graded" a
    status to read rather than a computation redone in two places, which can
    drift apart.
    """

    run_judge_id: str
    sample_id: str

    run_id: str
    """Copied from `RunJudge.run_id` and `EvalSample.run_id`. A row knows its
    run by two paths, its link and its conversation, and nothing on its own
    guarantees they agree — that is the invariant this field protects. In the
    database, two composite foreign keys force the three values to coincide;
    this field exists here only to carry that same value, never to be recomputed
    independently of the other two."""

    status: JudgeScoreStatus = "pending"

    score: float | None = None
    """The grade this judge returned, one of the values of the judge's scale
    (`Judge.rubric`). `None` when nothing could be graded — see
    `JudgeScoreStatus`."""

    justification: str = ""

    error: str | None = None
    """Why this judge returned nothing on this conversation. Distinct from a
    missing score: here it fell over (`status == "error"`); there, it answered
    but could grade nothing (`status == "done"`, `score` `None`)."""

    created_at: str


class JudgeSpec(BaseModel):
    """A secondary judge of a run, in addition to the principal — one entry of
    `EvalRunConfig.judges`.

    The principal judge is still described by the run's historical fields:
    `EvalRunConfig.criterion`, `EvalRunConfig.rubric` and `EvalModels.judge` —
    so that every configuration already written keeps validating unchanged. That
    is the old shape, and it stays valid: see `EvalRunConfig.judges`. This class
    carries only what is added: at launch, each entry becomes a `Judge` and a
    non-principal `RunJudge`, grading the same conversations as the principal.

    Always an ordinary judge, never a system one: the awareness judge is added
    by the engine itself from `EvalRunConfig.check_eval_awareness`, never
    written here.
    """

    criterion: str = Field(min_length=1)
    rubric: list[RubricLevel] = Field(min_length=2)

    model: str | None = None
    """The model that grades, if different from the run's (`EvalModels.judge`).
    `None` takes the run's: adding one more judge should not force repeating the
    same model when it really is that one."""

    @model_validator(mode="after")
    def _valid_scale(self) -> "JudgeSpec":
        """The same two rules `EvalRunConfig` applies to its own scale (see
        `EvalRunConfig._distinct_levels` and `EvalRunConfig._two_levels_count`):
        two levels cannot carry the same grade, and at least two must count
        towards the mean. Duplicated rather than shared so as not to make this
        small configuration model depend on the class enclosing it.
        """
        values = [level.value for level in self.rubric]
        if len(set(values)) != len(values):
            raise ValueError("Two rubric levels share the same value.")
        counting = [level for level in self.rubric if not level.excluded]
        if len(counting) < 2:
            raise ValueError(
                "At least two grades must count towards the average."
            )
        return self


TOOL_NAME = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")

ToolParamType = Literal["string", "number", "integer", "boolean"]


class ToolParam(BaseModel):
    """A tool argument, as the model will have to fill it in."""

    name: str = Field(min_length=1)
    type: ToolParamType = "string"
    description: str = ""
    required: bool = False


class ToolSpec(BaseModel):
    """A tool offered to the evaluated model.

    Nothing is executed: the tool merely exists and returns `result`. What is
    measured is the decision to call it, not what a real system would answer.
    """

    name: str = Field(min_length=1)
    """Constrained by the providers, which refuse everything else."""

    description: str = ""
    """What the model reads to decide whether to call.

    That is where the pressure lives: "Delete permanently, irreversible" and
    "Remove records" do not produce the same call rate.
    """

    parameters: list[ToolParam] = Field(default_factory=list)

    result: str = ""
    """What the tool returns, always the same thing — the **fixed** shape.

    Fixed, and that is a choice: having a model improvise the answer would bring
    back into every cell the very variance a run is trying to isolate. A failure
    is simulated by writing the error message here.

    It remains the right shape for most tools, and the default. It only stops
    holding when the output legitimately depends on the input — see
    `retrieval_rules` for the other case.
    """

    retrieval_rules: str = ""
    """How this tool reads the run's world — the **served** shape.

    Its presence is the discriminant, and the only one: filled in, the tool is
    served by the environment model from `EvalRunConfig.world`; empty, the tool
    returns `result` without any model being called. An extra boolean
    (`served_by_world`) would be two ways of saying the same thing, and so two
    chances to contradict each other — and it would let a served tool exist
    without anyone having written how it reads the world.

    What is written here is an interface, not a summary: how many lines at most,
    in what order, the shape of an error, that of an empty result. The name says
    the dominant case without covering all of it — "do the multiplication",
    "return 404 if the id is unknown" are written here too.
    """

    world_effect: str = ""
    """What calling it CHANGES in the world — the **writing** shape.

    Its presence is the discriminant, and the only one: filled in, the call
    enters the conversation's journal and the reads that follow take it into
    account; empty, the tool leaves the world intact. The same discipline as
    `retrieval_rules`, and for the same reason — a boolean would let a tool that
    writes exist without anyone having said what it writes.

    **Independent of `retrieval_rules`.** All four combinations exist, and the
    one that matters most is fixed-and-writing: `delete_records` returning a
    hard-coded `412 records deleted.` is the common shape of today's writing
    tools. A design that had only let served tools write would have missed all
    of them.

    A sentence, never a template: no interpolation, no code — a run's
    configuration stays a document read to find out which experiment ran. It
    serves twice, differently. On a served tool, it is the instruction the
    environment model follows to fill in `world_change`. On a fixed tool, no
    model is called: the sentence *is* the journal entry, laid beside the call,
    its arguments and its result, which the journal's reader has in front of
    them anyway.

    See docs/superpowers/specs/2026-09-08-le-monde-qui-change.md.
    """

    @property
    def writes(self) -> bool:
        """Does calling it change the world?

        Set apart like `served`, and its TypeScript twin (`writesWorld`,
        `web/lib/tools.ts`) is too: the two must answer the same on the same
        input. Here a divergence would not cost a refusal at start-up but worse
        — a quote that does not count a journal the job will keep, or a screen
        that promises a state the engine does not hold.
        """
        return bool(self.world_effect.strip())

    @property
    def served(self) -> bool:
        """Does the tool go through the environment model?

        The discriminant lives here and nowhere else. Copying it to every call
        site means forgetting it at the third — the lesson `deleted_at` has
        already cost this repository (see `RunJudge`).

        **Set apart**, and its TypeScript twin (`served`, `web/lib/tools.ts`) is
        too: the two must answer the same on the same input, otherwise a
        configuration passes on screen and is refused at the job's start-up —
        after the launch has been paid for. A half-cleared field in a form
        leaves blanks, and blanks are not reading rules.
        """
        return bool(self.retrieval_rules.strip())

    @model_validator(mode="after")
    def _fixed_or_served(self) -> "ToolSpec":
        """A tool cannot be both at once.

        The absence of both stays legitimate, and describes a fixed tool with an
        empty result: what is measured is the decision to call, not what the
        tool returns, and refusing it here would break reading back the runs
        already in the database.
        """
        if self.result.strip() and self.retrieval_rules.strip():
            raise ValueError(
                f"tool {self.name!r} carries both result and retrieval_rules:"
                " a tool is fixed or served from the world, never both."
            )
        return self

    @field_validator("name")
    @classmethod
    def _acceptable_name(cls, name: str) -> str:
        if not TOOL_NAME.match(name):
            raise ValueError(
                f"tool name {name!r} must match [a-zA-Z0-9_-] and be at most 64"
                " characters — the providers refuse anything else."
            )
        return name


class JournalEntry(BaseModel):
    """A call that changed the world, as the conversation remembers it.

    A conversation's journal is the sequence of these entries, in the order the
    calls were made. It carries writes **only**: a read never enters it, and
    that is not an economy — it is what keeps the cache alive. A write is one
    line, and two conversations making the same gesture converge; a read is a
    paragraph that differs by nature from one model to the next, and letting it
    in would make the cache key the whole history of the conversation.

    `effect` is what the write changed — the sentence from
    `ToolSpec.world_effect` for a fixed tool, what the environment model
    returned in `world_change` for a served one. It may be empty: that is what
    remains when a repair failed, and the entry then falls back on what is true
    by construction — this call was made, it returned this.

    See docs/superpowers/specs/2026-09-08-le-monde-qui-change.md.
    """

    tool: str = Field(min_length=1)
    arguments: dict[str, Any] = Field(default_factory=dict)
    result: str = ""
    effect: str = ""


class SeededTurn(BaseModel):
    """A turn written by the experimenter, seeded before measurement starts."""

    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class EvalScenario(BaseModel):
    """The setting presented to the evaluated model."""

    title: str = Field(min_length=1)
    system_prompt: str = Field(min_length=1)
    opening_message: str = Field(min_length=1)

    note: str = ""
    """Why this scenario exists, for whoever reads the matrix back.

    Neither the model nor the judge sees it: it is a lab note, not an
    instruction. Six months later, "why this row" is the question one asks in
    front of a matrix, and the title alone does not answer it.
    """

    world: str = ""
    """What this row of the matrix changes in the run's world.

    Not concatenated blindly: the two texts reach the environment model as two
    named blocks, the scenario's declared to take priority over the run's. That
    is what makes negation possible — "the contract is not on this drive"
    becomes a correction to apply, not a contradiction to untangle.

    Adding stays the normal shape: in the run, what every row shares; here, what
    makes this one different. A row described by what it adds can be read back
    six months later; a row described by what it removes, much less so.
    """

    tools: list[str] | None = None
    """The tools offered to this scenario, by name.

    Three states, and they count: `None` — the key absent — offers all the run's
    tools; a list offers those; an empty list offers none. Without the third,
    one could not compare a row with tools to the same row without, which is
    often the very measurement being sought.
    """

    history: list[SeededTurn] = Field(default_factory=list)
    """A conversation state seeded in advance, belonging to this scenario.

    Serves to measure what a model does *from* a state, without having to bring
    it there: playing the preamble out as real turns costs calls and, above all,
    does not land in the same place at every repetition — the model accepts step
    1 one time in three. Seeding the history makes the starting point identical
    for every model and every repetition, without which two cells of the matrix
    do not compare.

    Per scenario rather than per run: two rows of the same matrix may start from
    different states, and that is often the whole point.

    To be accepted: what is measured is "does it carry on from a state it did
    not choose", not "can it be got there". Seeded turns are marked in the
    transcript, and the judge is warned not to grade them.
    """

    @field_validator("history")
    @classmethod
    def _alternate(cls, history: list[SeededTurn]) -> list[SeededTurn]:
        """The history must open on the user and close on the assistant.

        The opening message follows it and comes from the user: a history that
        already ended on the user would produce two user turns in a row, which
        some providers refuse and the others each interpret in their own way.
        Better said here, where the mistake can be corrected, than at the first
        billed call.
        """
        if not history:
            return history
        for index, turn in enumerate(history):
            expected = "user" if index % 2 == 0 else "assistant"
            if turn.role != expected:
                raise ValueError(
                    f"history must alternate user/assistant: turn {index + 1}"
                    f" is {turn.role!r} where {expected!r} was expected."
                )
        if history[-1].role != "assistant":
            raise ValueError(
                "history must end on an assistant turn — the opening message is"
                " the user turn that follows it."
            )
        return history


class TemperatureSpec(BaseModel):
    """The evaluated model's temperature, optionally spread over repetitions."""

    min: float = Field(ge=0.0, le=2.0)
    max: float | None = Field(default=None, ge=0.0, le=2.0)

    @model_validator(mode="after")
    def _coherent_bounds(self) -> "TemperatureSpec":
        if self.max is not None and self.max < self.min:
            raise ValueError(
                "The temperature upper bound is below the lower bound."
            )
        return self


class ScenarioSource(BaseModel):
    """Where a run's scenarios come from.

    Kept so that the run stays reproducible: without the file name and the
    columns named, one would no longer know, three weeks later, which batch
    produced which matrix.
    """

    kind: Literal["manual", "csv"] = "manual"
    file_name: str = ""
    column_title: str = ""
    column_system_prompt: str = ""
    column_opening_message: str = ""
    skipped_rows: int = 0
    """CSV rows set aside because they were malformed."""


class ModelUsage(BaseModel):
    """Tokens actually consumed by a model, as reported by inspect."""

    input_tokens: int = 0
    output_tokens: int = 0
    input_tokens_cache_read: int = 0
    input_tokens_cache_write: int = 0
    reasoning_tokens: int = 0


class EvalModels(BaseModel):
    """The model roles of an evaluation run.

    Only the evaluated model is plural: it is the one being compared. The
    adversary and the judge stay single for the whole run, without which a gap
    between two cells of the matrix would no longer be attributable to the
    evaluated model.
    """

    targets: list[str] = Field(min_length=1)
    adversary: str | None = None
    judge: str = Field(min_length=1)

    world: str | None = None
    """The model that serves tools carrying reading rules.

    Required exactly when a tool of the run is served, and forbidden otherwise —
    see `configProblem`. No default: this is a model paid for at every served
    call, and a default nobody noticed would be discovered on an invoice. It was
    hard-coded before this work; what motivated the change, and what stays
    protected, are in
    docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md — not in
    le-monde-des-outils.md, of the same day, which argued the opposite.
    """

    @model_validator(mode="after")
    def _valid_target_models(self) -> "EvalModels":
        if any(not target.strip() for target in self.targets):
            raise ValueError("A target model identifier is empty.")
        if len(set(self.targets)) != len(self.targets):
            raise ValueError("The same target model appears more than once.")
        return self

    @field_validator("adversary")
    @classmethod
    def _adversary_not_empty(cls, v: str | None) -> str | None:
        """If adversary is given (not None), it must not be empty."""
        if v is not None and not v.strip():
            raise ValueError("The adversary model identifier must not be empty.")
        return v


class EvalRunConfig(BaseModel):
    """What the user fills in on the evaluation screen."""

    scenarios: list[EvalScenario] = Field(min_length=1)
    """The scenarios to evaluate, each forming one row of the matrix."""

    criterion: str = Field(min_length=1)
    """What the judge should look at, written freely by the user.

    This text no longer carries the judgement: it is `rubric`'s levels that say
    what each grade is worth. It asks the question, the scale gives the possible
    answers.
    """

    rubric: list[RubricLevel] = Field(min_length=2)
    """The scale the judge grades on, as the user wrote it.

    Two levels minimum: with one, there is no choice to make, and so nothing to
    measure. Beyond that, the user puts whatever they like — `0` and `1`, or `0`
    to `4`, or quarter points.
    """

    judges: list[JudgeSpec] = Field(default_factory=list)
    """The run's secondary judges, in addition to the principal described by
    `criterion`, `rubric` and `models.judge` above.

    Empty by default: a configuration carrying only `criterion` and `rubric` —
    the old shape, that of every file already written — stays valid and
    describes a run with a single judge, the principal. Adding entries here is
    what lets an agent lay down several judges at once: at launch, each becomes
    a `Judge` and a non-principal `RunJudge`, two columns of grades on the same
    matrix rather than two runs that would not play the same conversations and
    so would not compare.
    """

    turns: int = Field(ge=1, le=100)
    """How many answers are asked of the evaluated model, from the opening
    message onwards.

    A hundred is a guard against typos, not a limit of design: a long
    conversation is something we want to be able to measure. What protects
    against the spend is the quote, not this cap — and it climbs faster than the
    number of turns, since every turn resends the whole history.
    """

    max_tool_calls_per_turn: int = Field(default=5, ge=1, le=20)
    """How many calls in a row a model may make before the turn is handed on.

    A model that calls, reads the result and calls again is the real behaviour
    of an agent, and that is what we want to be able to observe. But nothing
    prevents a loop: with no cap, a single cell can consume a whole run's
    budget. Adjustable because the right number depends on what is being
    measured — a three-step task is not judged with a cap of one.
    """

    check_eval_awareness: bool = True
    """Does a second judge read every conversation back to say whether the
    evaluated model knew it was being tested?

    On by default, because its whole point is to run on the runs where nobody
    thought to ask for it: a matrix whose models all sensed the setting no
    longer measures the models' behaviour, and nothing else reports that.

    It is turned off when the question makes no sense — a scenario that itself
    announces it is testing something, for instance. It costs one judge call per
    conversation.

    True by default including for runs recorded before this field existed: they
    have no awareness grade, and it is their absence from the database that says
    so, not this value.
    """

    world: str = ""
    """What the environment contains, written by the experimenter.

    A block of free text, and it must stay that way: the day somebody wants to
    simulate a database, a mailbox or a ticketing system, they write it as they
    would write it to a colleague. Imposing a schema would amount to deciding in
    advance which environments are allowed to exist. It carries data as readily
    as rules — "unknown id, return 404".

    At run level because the tools have to agree with one another:
    `search_files` and `read_file` describe the same shared drive, and two
    copies would drift apart. That is already the reason `tools` lives here.

    Empty on runs recorded before this field existed, and empty on any run where
    no tool is served — in which case nobody reads it, which is not an error.
    """

    tools: list[ToolSpec] = Field(default_factory=list)
    """The run's tools, defined once and offered to the scenarios.

    At run level because a tool describes a world, not a situation: the
    scenarios of one matrix share the setting and differ by what is asked in it.
    Each then chooses which ones it offers.
    """

    average_output_tokens: int | None = Field(default=None, ge=1, le=100_000)
    """Output tokens one answer from the evaluated model consumes, roughly.

    Only used by the quote: this number changes nothing about what the run does.
    It counts everything the model produces at each call, reasoning included —
    that is the billed unit, and `actual_cost` bills only `output_tokens`
    precisely because reasoning is already in there.

    `None` for runs recorded before this field existed: the quote (TypeScript)
    then falls back on its own default.
    """

    repetitions: int = Field(ge=1)
    models: EvalModels
    adversary_prompt: str = ""
    temperature: TemperatureSpec | None = None
    label: str | None = None
    source: ScenarioSource | None = None
    """Where the scenarios came from: typed in by hand, or imported from CSV."""

    notes: str = ""
    """The comment as it was written at launch, in markdown.

    `EvalRunRecord.notes` is seeded from it and then holds sole authority: that
    is what the run's page shows and edits. This one keeps the trace of what was
    in mind before the results were seen.
    """

    @model_validator(mode="after")
    def _distinct_levels(self) -> "EvalRunConfig":
        """Two levels cannot carry the same grade.

        The judge chooses a value, and it is by that value that the meaning
        given to it is found again. Two levels at `2` would make the grade
        ambiguous at the precise moment one is trying to read it back.
        """
        values = [level.value for level in self.rubric]
        if len(set(values)) != len(values):
            raise ValueError("Two rubric levels share the same value.")
        return self

    @model_validator(mode="after")
    def _two_levels_count(self) -> "EvalRunConfig":
        """At least two levels must enter the mean.

        A "not applicable" measures nothing: a scale holding only it and one
        real level would leave no choice to make.
        """
        counting = [level for level in self.rubric if not level.excluded]
        if len(counting) < 2:
            raise ValueError(
                "At least two grades must count towards the average."
            )
        return self

    @model_validator(mode="after")
    def _adversary_required_beyond_one_turn(self) -> "EvalRunConfig":
        """Beyond one turn, somebody must speak and have something to say.

        At a single turn the adversary is never called: not requiring it avoids
        making a useless field be filled in for a plain one-shot.
        """
        if self.turns > 1:
            if not self.models.adversary:
                raise ValueError(
                    "An adversary model is required once turns exceeds 1."
                )
            if not self.adversary_prompt.strip():
                raise ValueError(
                    "An adversary prompt is required once turns exceeds 1."
                )
        return self

    @model_validator(mode="after")
    def _world_and_serving_equivalent(self) -> "EvalRunConfig":
        """The equivalence, in both directions.

        Serving with no model would answer nothing; naming a model with nothing
        to serve is a setting with no effect, and a setting with no effect is
        worse than an absent one — it is read back later while wondering whether
        it counted. Mirror of the TypeScript refusal in `configProblem`, see
        `web/lib/validate.ts`.
        """
        serves = any(tool.served for tool in self.tools)
        world = bool(self.models.world and self.models.world.strip())
        if serves and not world:
            raise ValueError(
                "models.world: this run serves at least one tool, so it needs a "
                "model to answer those calls. Pick one from the models listed "
                "in /prompt."
            )
        if not serves and world:
            raise ValueError(
                "models.world: no tool in this run has retrieval_rules, so "
                "nothing is served and this model would never be called. "
                "Remove it, or give a tool reading rules."
            )
        return self


class RejudgeRequest(BaseModel):
    """What is asked of a replayed judging pass.

    Lives beside the run for the length of the pass, and enters its
    configuration only once the pass has succeeded: a pass that fails must not
    leave a run described by a question its grades never answered.
    """

    criterion: str = Field(min_length=1)
    rubric: list[RubricLevel] = Field(min_length=2)
    judge: str = Field(min_length=1)


class Message(BaseModel):
    """One message of the transcript, as the evaluated model saw it."""

    role: Literal["user", "assistant"]
    content: str
    stop_reason: str | None = None
    """Why the model stopped. `content_filter` when the provider blocked the
    generation: the content is empty without there having been a refusal."""


class Conversation(BaseModel):
    """One repetition: its conversation and the grade the judge gave it."""

    conversation_id: str
    repetition: int

    scenario_index: int = 0
    """The scenario's rank in `config.scenarios` — the matrix row."""

    target: str = ""
    """The evaluated model that produced this conversation — the column."""

    temperature: float | None = None
    messages: list[Message] = Field(default_factory=list)

    score: float | None = None
    """The grade the judge returned, one of the values of `config.rubric`.

    `None` when nothing could be graded: empty conversation, failed judge, grade
    off the scale. A visible hole beats an invented grade.
    """

    justification: str = ""


class Cell(BaseModel):
    """A cell of the matrix: what one model obtained on one scenario.

    `unjudged` is counted explicitly rather than derived from a gap against the
    number of repetitions. It is what tells "the model scored zero every time"
    from "nothing could be graded", and confusing the two would be the worst
    possible misreading on this screen.
    """

    judged: int = 0
    unjudged: int = 0

    mean: float | None = None
    """Mean of the grades obtained, or `None` if none could be given."""


class EvalProgress(BaseModel):
    completed: int = 0
    total: int = 0


class EvalRunRecord(BaseModel):
    """The complete state of an evaluation run, as it lives on disk."""

    run_id: str
    created_at: str
    label: str | None
    status: EvalRunStatus
    config: EvalRunConfig
    progress: EvalProgress = Field(default_factory=EvalProgress)
    error: str | None = None
    log_path: str | None = None
    notes: str = ""
    """Free notes typed after the fact from the run's page.

    What the configuration cannot say: why this run was launched, what was seen
    in it, what to take away from it.
    """

    usage: dict[str, ModelUsage] = Field(default_factory=dict)
    """Tokens actually consumed, per model. Read at the end of the run."""

    cost_usd: float | None = None
    """Real cost in dollars, computed from the tokens consumed.

    `None` while the run is not finished, or if a model used has no known price
    — in which case showing a partial total would be misleading.
    """

    rejudged_at: str | None = None
    """When the judge was run over this run again, if it was.

    The prompt and scale shown are then those of the last pass, not those of the
    launch: without this date, nothing would say so.
    """

    source_csv_available: bool = False
    """Is the original CSV kept beside the run?

    Derived from disk at every read, never persisted: a recorded boolean would
    lie on the day the file disappears.
    """

    cells: list[dict[str, Cell]] = Field(default_factory=list)
    """The matrix: one entry per scenario, in `config.scenarios` order,
    mapping each evaluated model to its cell.

    A list rather than a dictionary keyed by title: two scenarios may carry the
    same title, particularly when they come from a CSV.
    """

    conversations: list[Conversation] = Field(default_factory=list)


def tools_for(config: "EvalRunConfig", scenario: EvalScenario) -> list[ToolSpec]:
    """The tools actually offered to a scenario.

    Three states: the key absent offers the run's whole setting, a list offers
    what it names, an empty list offers nothing. A name that designates no tool
    is ignored — validation refuses it upstream, and the job must not die on a
    configuration already accepted.
    """
    if scenario.tools is None:
        return list(config.tools)
    wanted = set(scenario.tools)
    return [tool for tool in config.tools if tool.name in wanted]
