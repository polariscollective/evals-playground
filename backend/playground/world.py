"""The world: what exists, and the model that serves calls from that text.

A tool is either fixed or served. Fixed, it returns `ToolSpec.result` and
nothing happens here. Served — it carries `retrieval_rules` — this module
produces its answer, by handing a small model the run's world, the scenario's,
the tool's reading rules, its name and its arguments.

Since `2026-09-08-le-monde-qui-change.md` it receives one thing more: the
conversation's **journal** — the sequence of calls that changed the world, and
those alone.

**And nothing else.** Not the conversation, not the criterion, not the grades,
not what the other READS returned. That closed list is not an economy measure:
it is what makes the result a pure function of its key — which now carries the
journal as well — and therefore what makes the cache correct rather than
approximate. Letting reads into it would make the key the whole history of the
conversation, and there would be nothing left to cache: two conversations that
looked for different things would never share anything again. Writes, by
contrast, are few and they converge — two repetitions that delete the same file
have the same journal.

See docs/superpowers/specs/2026-09-07-le-monde-des-outils.md, then
docs/superpowers/specs/2026-09-08-le-monde-qui-change.md.
"""

import hashlib
import json
from collections.abc import Sequence
from typing import Any, NamedTuple

from inspect_ai.model import ChatMessageSystem, ChatMessageUser, Model
from inspect_ai.tool import Tool, ToolFunction, tool

from playground.eval_schemas import JournalEntry, ToolSpec
from playground.tool_calls import tool_call_arguments
from playground.shared_data import load

_SHARED = load("world-prompt")
"""The environment prompt, shared.

The interface reads it to count its tokens in the quote. If it kept a copy of
its own, the quote would end up pricing something other than what goes out — a
lie nobody would see. Changing it is done in `shared/world-prompt.json`.
"""

WORLD_SYSTEM: str = _SHARED["system"]

CHECK_MODELS: list[str] = _SHARED["check_models"]
"""The candidates for checking what the environment returned, in order.

The server (`config.models.world`) has been a per-run choice since Task 2; the
checker can therefore no longer be a single constant — a fixed checker would
become hollow, without saying so, the day the chosen server shared its family.
`check_model_for` keeps the first candidate from a provider other than the
server's: two families, so two ways of being wrong that do not coincide. A
checker sharing the server's bias would validate exactly the errors we are
looking for.

That the list covers at least two providers is a requirement on this file, not
a case to handle here: `tests/test_world.py` checks it.
"""


def check_model_for(world_model: str) -> str:
    """The checker for a run served by `world_model`: the first candidate in
    `CHECK_MODELS` from another provider.

    The provider is the part of the identifier before the `/`. If no candidate
    differs — a fault in the shared file, not a runtime case, see
    `CHECK_MODELS` — the first candidate is returned anyway, so that this never
    hands back anything but a callable model.
    """
    provider = world_model.split("/")[0]
    return next(
        (
            candidate
            for candidate in CHECK_MODELS
            if candidate.split("/")[0] != provider
        ),
        CHECK_MODELS[0],
    )


def check_models_after(world_model: str, failed: Sequence[str]) -> str | None:
    """The next checker to try, once `failed` are set aside.

    The fallback from the spec, in order: a candidate from a family other than
    the server's first, one from the same family next — a checker with a shared
    bias beats no check at all, and the caller says so — then `None`, which
    means serve without checking.

    Returning `None` rather than raising: a checker failing never kills an
    attempt, it leaves a row with a null `faithful` for the after-run pass to
    pick up.
    """
    set_aside = set(failed)
    provider = world_model.split("/")[0]
    remaining = [c for c in CHECK_MODELS if c not in set_aside]
    other_family = [c for c in remaining if c.split("/")[0] != provider]
    return (other_family or remaining or [None])[0]


CHECK_SYSTEM: str = _SHARED["check_system"]


def arguments_key(arguments: dict[str, Any]) -> str:
    """A call's arguments, in canonical form.

    Keys are sorted: a model returning `{"b": 2, "a": 1}` and another returning
    `{"a": 1, "b": 2}` made the same call, and must receive the same answer.
    Without that sort, two repetitions of the same scenario would miss the cache
    and see two different worlds.

    `ensure_ascii=False` so the form stays readable when a `tool_results` row is
    read back six months later.
    """
    return json.dumps(arguments or {}, sort_keys=True, ensure_ascii=False)


def result_key(tool_name: str, arguments: dict[str, Any]) -> str:
    """The identity of a served call, as it lives in the primary key.

    A hash rather than the arguments themselves: they may carry a query several
    kilobytes long, and this is an indexed column. The readable arguments travel
    alongside, in a column of their own, so that what was asked can still be
    read back.

    The tool name goes into the hash: two tools called with no arguments do not
    share their answer.
    """
    fingerprint = f"{tool_name}\n{arguments_key(arguments)}"
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


EMPTY_STATE = ""
"""The fingerprint of an empty journal.

The empty string rather than the hash of nothing, for three reasons pointing
the same way: it is the column's default value, so a `tool_results` row written
before this work carries it with nothing to recompute; a conversation that has
written nothing yet is recognisable at a glance in the database; and the key of
a run with no writing tool stays exactly what it was, bit for bit.
"""


def state_key(journal: Sequence[JournalEntry]) -> str:
    """The journal's fingerprint, as it enters the cache key.

    **The one from BEFORE the call**, always. A call's entry carries its own
    result; hashing the journal from after would make the key used to find that
    result depend on it. A write is served and cached against the state it
    found, never against the state it leaves.

    Arguments go through `arguments_key`, so they are sorted: two conversations
    that made the same gesture, written with keys in a different order, have the
    same journal and must share their cache.
    """
    if not journal:
        return EMPTY_STATE
    fingerprint = json.dumps(
        [
            [entry.tool, arguments_key(entry.arguments), entry.result, entry.effect]
            for entry in journal
        ],
        ensure_ascii=False,
    )
    return hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def journal_text(journal: Sequence[JournalEntry]) -> str:
    """The journal as the model reads it: one entry per call, in order.

    The effect line is written only when there is one. An entry with no effect
    is not an anomaly: it is what remains when a repair failed and we fall back
    on what is true by construction — this call was made, it returned this. A
    `changed:` header followed by nothing would send the reader looking for a
    meaning that is not there.
    """
    entries = []
    for entry in journal:
        lines = [
            _SHARED["journal_entry"].format(
                tool=entry.tool,
                arguments=arguments_key(entry.arguments),
                result=entry.result,
            )
        ]
        if entry.effect.strip():
            lines.append(
                _SHARED["journal_effect_line"].format(effect=entry.effect.strip())
            )
        entries.append("\n".join(lines))
    return _SHARED["journal_separator"].join(entries)


def world_prompt(
    world: str,
    scenario_world: str,
    journal: Sequence[JournalEntry],
    tool: ToolSpec,
    arguments: dict[str, Any],
    fault: str = "",
) -> tuple[str, str]:
    """The system message and the user message sent to the environment.

    The signature is the closed list of what the model sees — see the module
    docstring. It accepts no other argument, and that is deliberate: the day
    somebody wants to hand it the conversation, they will have to change this
    line, read why, and own having killed the cache.

    `journal` is the only thing added since, and under a strict condition:
    writes only. Letting it receive reads would amount exactly to handing it the
    conversation.

    Four blocks are written only when they carry text — the scenario's, the
    journal's, the effect's, the repair's. A header followed by nothing would be
    noise, and a model would look for a meaning in it.

    `fault` is the reason the checker gave for refusing a first answer to this
    same call. The only repair granted, and it has a price named in the spec:
    the second answer is written to satisfy the checker, so the checker's
    verdict on it is worth less than on the first. That is why a repaired row is
    counted separately.

    Returns:
        The pair (system, user).
    """
    blocks = [_SHARED["world_block"].format(world=world.strip())]
    if scenario_world.strip():
        blocks.append(
            _SHARED["scenario_block"].format(scenario_world=scenario_world.strip())
        )
    if journal:
        blocks.append(_SHARED["journal_block"].format(journal=journal_text(journal)))
    blocks.append(
        _SHARED["call_block"].format(
            tool=tool.name, arguments=arguments_key(arguments)
        )
    )
    if tool.retrieval_rules.strip():
        blocks.append(_SHARED["rules_block"].format(rules=tool.retrieval_rules.strip()))
    if tool.world_effect.strip():
        blocks.append(_SHARED["effect_block"].format(effect=tool.world_effect.strip()))
    if fault.strip():
        blocks.append(_SHARED["repair_block"].format(fault=fault.strip()))
    return WORLD_SYSTEM, _SHARED["separator"].join(blocks)


class ServeRefused(Exception):
    """The environment model answered, but not through the field.

    Distinct from a provider failure, which propagates as it stands: here the
    call succeeded, and it is the shape that is missing — prose instead of
    `submit_result`, a refusal, an empty message. A category that did not exist
    before the output was closed, and that is the price of closing it.

    The caller turns it into one retry, then kills the attempt: we do not serve
    what does not exist. See `batch_job.serve_tool`.
    """


class Served(NamedTuple):
    """What the environment returns for one call.

    `reasoning` goes nowhere but the database: neither to the evaluated model,
    where it would be the product's biggest tell if it leaked into a `TOOL`
    turn, nor to the checker, for whom it would serve as the defence's plea.
    """

    reasoning: str
    result: str
    world_change: str


@tool
def submit_result() -> Tool:
    """The environment's output tool, never executed. Only the schema matters."""

    async def execute(result: str, reasoning: str = "", world_change: str = "") -> str:
        """Records what the tool returned.

        Args:
            result: Exactly what the tool returned, raw, with nothing else.
            reasoning: Your own working out. Nobody reads it but you.
            world_change: What this call changed in the world, in one sentence
                and in the past tense. Empty when it changed nothing.
        """
        return "recorded"

    return execute


async def serve(
    model: Model,
    world: str,
    scenario_world: str,
    journal: Sequence[JournalEntry],
    tool: ToolSpec,
    arguments: dict[str, Any],
    fault: str = "",
) -> Served:
    """What the tool returns for this call, and what the call changes.

    An output tool, no longer the raw completion. Two reasons, the second being
    the one that settled it.

    **The model needs somewhere to think.** Composing the world with what has
    happened to it since is no longer a transcription. Without a field of its
    own, its working out would go out verbatim in the `TOOL` turn the evaluated
    model reads — the biggest tell imaginable, in the very function the whole
    setting depends on.

    **And the field closes the result.** What is served is a named field, no
    longer a free completion any prose can leak into. That benefit holds for
    every call, journal or not: hence one shape, never conditional.

    Edge whitespace is stripped from the result: a model that wraps its output
    in line breaks would produce a tool result that looks like no real interface
    at all, which is exactly the tell we are trying to avoid.

    Raises:
        ServeRefused: if the model did not fill in `submit_result`.
    """
    system, message = world_prompt(
        world, scenario_world, journal, tool, arguments, fault
    )
    output = await model.generate(
        input=[ChatMessageSystem(content=system), ChatMessageUser(content=message)],
        tools=[submit_result()],
        tool_choice=ToolFunction(name="submit_result"),
    )
    try:
        returned = tool_call_arguments(output, "submit_result", required=("result",))
    except ValueError as reason:
        raise ServeRefused(str(reason)) from reason
    # A tool that declares no effect produces none, whatever the model says.
    # Observed against real models: on a `search_files` with no `world_effect`,
    # one of them filled the field with "Nothing changed; the search returned no
    # results" — polite, and false as a declaration.
    #
    # Letting it through would be a regression of principle: it is the
    # CONFIGURATION that says what writes, never a model's judgement. An effect
    # born of an opinion would enter the cache key the day the tool gained a
    # declaration, and two identical conversations would stop sharing their row
    # on a matter of mood.
    change = str(returned.get("world_change") or "").strip()
    return Served(
        reasoning=str(returned.get("reasoning") or "").strip(),
        result=str(returned.get("result") or "").strip(),
        world_change=change if tool.writes else "",
    )


# --- The check -----------------------------------------------------------
#
# A distinct question, and one that bears on no evaluated model: did the model
# that served this call do its job? This is not a judge — a judge grades a
# conversation, this one never sees it. It checks exactly
# `(world, journal, call) → result`, that is, the cache key, which makes it far
# cheaper than a judge: as many calls as there are DISTINCT results, not as many
# as there are conversations.
#
# Since `2026-09-08-le-monde-qui-change.md` it speaks BEFORE we serve, not only
# after the run — the only way to retry once before the evaluated model has read
# the answer. The after-run pass remains, as a net.


@tool
def submit_check() -> Tool:
    """The check's output tool, never executed. Only the schema matters."""

    async def execute(faithful: bool, fault: str = "") -> str:
        """Records whether the answer holds up.

        Args:
            faithful: True if this answer could have come from this call
                against this world.
            fault: When it could not, one sentence saying what is wrong with
                it. Empty when it holds up.
        """
        return "recorded"

    return execute


def check_prompt(
    world: str,
    journal: Sequence[JournalEntry],
    tool: str,
    arguments: dict[str, Any],
    result: str,
    world_change: str = "",
) -> tuple[str, str]:
    """The system message and the user message sent to the check.

    The signature is closed, like `world_prompt`'s, and what it refuses comes
    down to two different reasons.

    It refuses the `retrieval_rules`: a result that overruns the twenty-line cap
    is still a plausible result, and that is not the fault we are after —
    showing them would invite the checker to grade compliance instead of
    coherence.

    It also refuses, and above all, the server's `reasoning`. The checker is
    from another family on purpose, so that the two ways of being wrong do not
    coincide; giving it the justification of the one it is checking is giving it
    the defendant's plea — it would grade the story instead of the result.

    The world and the journal, by contrast, are indispensable: without the first
    an invention is undetectable; without the second, a correct read of an
    already-modified world would look like a contradiction.

    `world_change` is checked on the same footing as the result: it is what will
    enter the state and skew everything after it if it is wrong.
    """
    blocks = [_SHARED["check_world_block"].format(world=world.strip())]
    if journal:
        blocks.append(
            _SHARED["check_journal_block"].format(journal=journal_text(journal))
        )
    blocks.append(
        _SHARED["check_call_block"].format(
            tool=tool, arguments=arguments_key(arguments)
        )
    )
    blocks.append(_SHARED["check_answer_block"].format(result=result))
    if world_change.strip():
        blocks.append(_SHARED["check_effect_block"].format(effect=world_change.strip()))
    return CHECK_SYSTEM, _SHARED["separator"].join(blocks)


async def check(
    model: Model,
    world: str,
    journal: Sequence[JournalEntry],
    tool: str,
    arguments: dict[str, Any],
    result: str,
    world_change: str = "",
) -> tuple[bool, str]:
    """Could this result have come out of this call, and if not why.

    A fault with no reason is reduced to a generic sentence rather than left
    empty: the database refuses `faithful = false` with an empty `fault` — an
    indicator announcing "three unfaithful" where drilling in teaches nothing is
    useless — and a check that brought the job down on its own negligence would
    be worse than the fault it reports.

    The reason now serves twice: it is recorded, and it goes back to the server
    for the one repair granted to it.

    Returns:
        The pair (faithful, fault). `fault` is empty when `faithful` is true.
    """
    system, message = check_prompt(
        world, journal, tool, arguments, result, world_change
    )
    output = await model.generate(
        input=[ChatMessageSystem(content=system), ChatMessageUser(content=message)],
        tools=[submit_check()],
        tool_choice=ToolFunction(name="submit_check"),
    )
    returned = tool_call_arguments(output, "submit_check", required=("faithful",))
    faithful = bool(returned.get("faithful"))
    fault = str(returned.get("fault") or "").strip()
    if faithful:
        return True, ""
    return False, fault or "the check gave no reason"
