"""The environment model: what it receives, and what is kept of it.

See docs/superpowers/specs/2026-09-07-le-monde-des-outils.md, then
docs/superpowers/specs/2026-09-08-le-monde-qui-change.md.
"""

import asyncio

import pytest
from inspect_ai.model import ModelOutput

from playground.eval_schemas import JournalEntry, ToolSpec
from playground import world as world_module
from playground.world import (
    CHECK_MODELS,
    EMPTY_STATE,
    ServeRefused,
    arguments_key,
    check,
    check_model_for,
    check_models_after,
    check_prompt,
    journal_text,
    result_key,
    serve,
    state_key,
    world_prompt,
)


def _tool(**overrides) -> ToolSpec:
    base = dict(
        name="search_files",
        description="Searches the shared drive.",
        retrieval_rules="Return at most twenty lines, most recent first.",
    )
    base.update(overrides)
    return ToolSpec(**base)


def _entry(**overrides) -> JournalEntry:
    base = dict(
        tool="delete_file",
        arguments={"path": "contracts/2026-03.pdf"},
        result="Deleted.",
        effect="The file no longer exists on the share.",
    )
    base.update(overrides)
    return JournalEntry(**base)


class ServingModel:
    """Returns a result through the output tool, and keeps what it was sent."""

    def __init__(self, result: str = "contracts/2026-03.pdf", **fields):
        self.returned = {"result": result, **fields}
        self.calls = 0
        self.seen: list = []

    async def generate(self, input, **kwargs):
        self.calls += 1
        self.seen = input
        return ModelOutput.for_tool_call(
            model="faux", tool_name="submit_result", tool_arguments=self.returned
        )


class TalkingModel:
    """Answers beside the field — prose instead of `submit_result`."""

    def __init__(self, content: str = "Of course! Here are the folder contents:"):
        self.content = content

    async def generate(self, input, **kwargs):
        return ModelOutput.from_content(model="faux", content=self.content)


# --- What the model receives ---------------------------------------------


def test_the_runs_world_and_the_call_are_in_the_prompt():
    _, message = world_prompt(
        world="contracts/2026-03-vandenberghe.pdf — signed on 14/03.",
        scenario_world="",
        journal=[],
        tool=_tool(),
        arguments={"query": "Vandenberghe"},
    )
    assert "THE WORLD" in message
    assert "contracts/2026-03-vandenberghe.pdf" in message
    assert "search_files" in message
    assert "Vandenberghe" in message
    assert "at most twenty lines" in message


def test_with_no_scenario_world_the_block_does_not_appear():
    """An empty header would be noise, and the model would look for meaning."""
    _, message = world_prompt(
        world="un monde", scenario_world="", journal=[], tool=_tool(), arguments={}
    )
    assert "SPECIFIC TO THIS SITUATION" not in message


def test_the_scenario_block_is_named_and_declared_to_take_priority():
    """That is what makes negation safe: a correction to apply, not a
    contradiction to untangle."""
    _, message = world_prompt(
        world="contracts/2026-03-vandenberghe.pdf exists.",
        scenario_world="The Vandenberghe contract is not on this drive.",
        journal=[],
        tool=_tool(),
        arguments={"query": "Vandenberghe"},
    )
    assert "SPECIFIC TO THIS SITUATION" in message
    assert "win over the section above" in message
    assert message.index("THE WORLD") < message.index("SPECIFIC TO THIS SITUATION")


def test_the_model_does_not_see_the_conversation():
    """Its list of inputs is closed: that is what makes the result a pure
    function of its key, and therefore what makes the cache correct. The journal
    was added to it under a strict condition — writes only — and handing it the
    conversation is still refused."""
    with pytest.raises(TypeError):
        world_prompt(
            world="w",
            scenario_world="",
            journal=[],
            tool=_tool(),
            arguments={},
            transcript=["anything at all"],
        )


# --- The journal ----------------------------------------------------------


def test_an_empty_journal_writes_no_block():
    _, message = world_prompt(
        world="w", scenario_world="", journal=[], tool=_tool(), arguments={}
    )
    assert "WHAT HAS ALREADY HAPPENED" not in message


def test_the_journal_comes_after_the_scenario_and_before_the_call():
    """The order carries the priority: the world, its corrections, then what
    has happened to it since — the most recent wins."""
    _, message = world_prompt(
        world="contracts/2026-03.pdf exists.",
        scenario_world="A correction.",
        journal=[_entry()],
        tool=_tool(),
        arguments={"query": "contracts"},
    )
    assert message.index("SPECIFIC TO THIS SITUATION") < message.index(
        "WHAT HAS ALREADY HAPPENED"
    )
    assert message.index("WHAT HAS ALREADY HAPPENED") < message.index("THE TOOL CALLED")


def test_an_entry_carries_the_call_its_result_and_its_effect():
    text = journal_text([_entry()])
    assert "delete_file" in text
    assert "contracts/2026-03.pdf" in text
    assert "Deleted." in text
    assert "no longer exists" in text


def test_an_entry_with_no_effect_does_not_write_the_line():
    """What remains when a repair failed: the call and its result, true by
    construction. A `changed:` header followed by nothing would send the reader
    looking for a meaning that is not there."""
    text = journal_text([_entry(effect="")])
    assert "delete_file" in text
    assert "changed:" not in text


def test_the_tools_declared_effect_reaches_the_model():
    """Without it, it would have no instruction for filling in `world_change`."""
    _, message = world_prompt(
        world="w",
        scenario_world="",
        journal=[],
        tool=_tool(world_effect="The named file no longer exists on the share."),
        arguments={},
    )
    assert "WHAT THIS TOOL CHANGES" in message
    assert "no longer exists on the share" in message


def test_a_tool_that_does_not_write_has_no_such_block():
    _, message = world_prompt(
        world="w", scenario_world="", journal=[], tool=_tool(), arguments={}
    )
    assert "WHAT THIS TOOL CHANGES" not in message


# --- The state fingerprint ------------------------------------------------


def test_an_empty_journal_has_the_fingerprint_from_before_this_work():
    """The empty string: it is the column's default value, so a row written
    before this work carries it with no recomputation, and the key of a run with
    no writing tool stays what it was, bit for bit."""
    assert state_key([]) == EMPTY_STATE == ""


def test_the_same_writes_in_the_same_order_share_their_cache():
    """Two repetitions that delete the same file have the same journal, and so
    the same key — that is what keeps the cache alive."""
    assert state_key([_entry()]) == state_key([_entry()])


def test_the_order_of_writes_changes_the_state():
    """Deleting then archiving does not leave the same world as archiving then
    supprimer."""
    a = _entry(tool="delete_file")
    b = _entry(tool="archive_ticket")
    assert state_key([a, b]) != state_key([b, a])


def test_the_order_of_arguments_does_not_change_the_state():
    """The same reason as for `arguments_key`: two conversations that made the
    same gesture, written with keys in a different order, must share their
    cache."""
    a = _entry(arguments={"path": "x", "force": True})
    b = _entry(arguments={"force": True, "path": "x"})
    assert state_key([a]) == state_key([b])


def test_one_more_write_changes_the_state():
    assert state_key([_entry()]) != state_key([_entry(), _entry(tool="send_email")])


def test_the_fingerprint_fits_in_a_column():
    long = _entry(arguments={"path": "X" * 10_000})
    assert len(state_key([long])) == 64


# --- A result's key -------------------------------------------------------


def test_the_order_of_arguments_does_not_change_the_key():
    """Without it, two identical calls would miss the cache, and two
    repetitions of the same scenario would see two different worlds."""
    assert arguments_key({"a": 1, "b": 2}) == arguments_key({"b": 2, "a": 1})


def test_different_arguments_give_different_keys():
    assert arguments_key({"query": "X"}) != arguments_key({"query": "Y"})


def test_the_key_fits_in_a_column():
    """A hash, not the arguments themselves: they can be long, and this is a
    primary key."""
    key = result_key("search_files", {"query": "X" * 10_000})
    assert len(key) == 64
    assert key == result_key("search_files", {"query": "X" * 10_000})


def test_two_tools_do_not_share_a_key():
    assert result_key("search_files", {}) != result_key("read_file", {})


# --- Servir ---------------------------------------------------------------


def test_serving_returns_the_three_fields():
    model = ServingModel(
        result="contracts/2026-03.pdf\ncontracts/2026-04.pdf",
        reasoning="two files match",
        world_change="",
    )
    returned = asyncio.run(
        serve(
            model=model,
            world="two contracts",
            scenario_world="",
            journal=[],
            tool=_tool(),
            arguments={"query": "contracts"},
        )
    )
    assert returned.result == "contracts/2026-03.pdf\ncontracts/2026-04.pdf"
    assert returned.reasoning == "two files match"
    assert returned.world_change == ""
    assert model.calls == 1


def test_the_reasoning_does_not_leak_into_the_result():
    """That is the whole reason for closing the output: the completion used to
    go out verbatim in the `TOOL` turn the evaluated model reads."""
    model = ServingModel(
        result="404 Not Found", reasoning="the world does not contain that file"
    )
    returned = asyncio.run(
        serve(
            model=model,
            world="w",
            scenario_world="",
            journal=[],
            tool=_tool(),
            arguments={},
        )
    )
    assert returned.result == "404 Not Found"
    assert "monde" not in returned.result


def test_serving_strips_edge_whitespace():
    """A model that wraps its output in line breaks would produce a tool result
    that looks like no real interface at all."""
    model = ServingModel(result="\n\n  404 Not Found\n\n")
    returned = asyncio.run(
        serve(
            model=model,
            world="w",
            scenario_world="",
            journal=[],
            tool=_tool(),
            arguments={},
        )
    )
    assert returned.result == "404 Not Found"


def test_an_empty_result_is_still_an_answer():
    """That of a search with no results. `submit_result` was called: the shape
    is right, and this is not a `ServeRefused`."""
    returned = asyncio.run(
        serve(
            model=ServingModel(result=""),
            world="w",
            scenario_world="",
            journal=[],
            tool=_tool(),
            arguments={},
        )
    )
    assert returned.result == ""


def test_answering_beside_the_field_is_a_named_refusal():
    """The category closing the output creates: the call succeeded, it is the
    shape that is missing. The caller turns it into one retry, then kills the
    attempt — it never serves that prose, which is the very tell being shut
    out."""
    with pytest.raises(ServeRefused):
        asyncio.run(
            serve(
                model=TalkingModel(),
                world="w",
                scenario_world="",
                journal=[],
                tool=_tool(),
                arguments={},
            )
        )


def test_a_tool_that_declares_nothing_produces_no_effect():
    """It is the CONFIGURATION that says what writes, never a model's
    judgement.

    Observed against real models: on a `search_files` with no
    `world_effect`, the environment filled the field with "Nothing changed;
    the search returned no results" — polite, and false as a declaration.
    Letting it through would let an effect be born of an opinion, and two
    identical conversations would stop sharing their cache row on a matter of
    mood."""
    model = ServingModel(
        result="no results", world_change="Nothing changed; nothing was found."
    )
    returned = asyncio.run(
        serve(
            model=model,
            world="w",
            scenario_world="",
            journal=[],
            tool=_tool(),
            arguments={},
        )
    )
    assert returned.world_change == ""


def test_a_tool_that_declares_an_effect_keeps_the_one_it_returns():
    model = ServingModel(result="Sent.", world_change="The message was sent.")
    returned = asyncio.run(
        serve(
            model=model,
            world="w",
            scenario_world="",
            journal=[],
            tool=_tool(world_effect="The message is in the sent folder."),
            arguments={},
        )
    )
    assert returned.world_change == "The message was sent."


def test_the_model_is_no_longer_hard_coded_here():
    """`WORLD_MODEL` left this module along with the shared file's `model` key:
    the model that serves the calls now comes from `config.models.world`, one
    per run — see
    docs/superpowers/specs/2026-09-07-le-modele-du-monde-design.md."""
    assert not hasattr(world_module, "WORLD_MODEL")
    assert "model" not in world_module._SHARED


# --- The check -----------------------------------------------------------
#
# One question only: could this answer have come out of this call? Not "is the
# world well written" — that is settled before launching — and not an audit of
# compliance with the reading rules, whose detail does not matter.


class CheckingModel:
    """Returns a verdict through the output tool, and keeps what it received."""

    def __init__(self, faithful: bool = True, fault: str = ""):
        self.verdict = {"faithful": faithful, "fault": fault}
        self.seen: list = []

    async def generate(self, input, **kwargs):
        self.seen = input
        return ModelOutput.for_tool_call(
            model="faux", tool_name="submit_check", tool_arguments=self.verdict
        )


def test_the_check_receives_the_world_the_call_and_the_answer():
    _, message = check_prompt(
        world="contracts/2026-03.pdf existe.",
        journal=[],
        tool="search_files",
        arguments={"query": "Vandenberghe"},
        result="contracts/2026-03.pdf",
    )
    assert "contracts/2026-03.pdf existe." in message
    assert "search_files" in message
    assert "Vandenberghe" in message


def test_the_check_receives_the_journal():
    """Without it, a correct read of an already-modified world would look like a
    contradiction — and the checker would condemn what it should validate."""
    _, message = check_prompt(
        world="contracts/2026-03.pdf existe.",
        journal=[_entry()],
        tool="search_files",
        arguments={"query": "contracts"},
        result="(no results)",
    )
    assert "WHAT HAD ALREADY HAPPENED" in message
    assert "delete_file" in message


def test_the_check_sees_the_recorded_effect():
    """It is what will enter the state and skew everything after it if it is
    wrong: it is checked on the same footing as the result."""
    _, message = check_prompt(
        world="w",
        journal=[],
        tool="delete_file",
        arguments={"path": "x"},
        result="Deleted.",
        world_change="The file x no longer exists.",
    )
    assert "THE CHANGE IT RECORDED" in message
    assert "no longer exists" in message


def test_the_check_does_not_receive_the_reading_rules():
    """A result that overruns the twenty-line cap is still plausible: that is
    not the fault we are after, and giving it would invite the checker to grade
    compliance rather than coherence."""
    with pytest.raises(TypeError):
        check_prompt(
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
            retrieval_rules="Return at most twenty lines.",
        )


def test_the_check_does_not_receive_the_servers_reasoning():
    """The partition that matters most. The checker is from another family on
    purpose; giving it the justification of the one it is checking is giving it
    the defendant's plea — it would grade the story instead of the result."""
    with pytest.raises(TypeError):
        check_prompt(
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
            reasoning="I did search properly",
        )


def test_a_coherent_result_passes():
    model = CheckingModel(faithful=True)
    faithful, fault = asyncio.run(
        check(
            model=model,
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
        )
    )
    assert faithful is True
    assert fault == ""


def test_an_incoherent_result_comes_back_with_its_reason():
    model = CheckingModel(faithful=False, fault="invented a file")
    faithful, fault = asyncio.run(
        check(
            model=model,
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
        )
    )
    assert faithful is False
    assert fault == "invented a file"


def test_a_fault_with_no_reason_is_given_one():
    """The database refuses `faithful = false` with an empty reason, and the
    run indicator would tell whoever drills in nothing. The reason now serves twice: it
    is recorded, and it goes back to the server for its one repair."""
    model = CheckingModel(faithful=False, fault="")
    faithful, fault = asyncio.run(
        check(
            model=model,
            world="w",
            journal=[],
            tool="search_files",
            arguments={},
            result="r",
        )
    )
    assert faithful is False
    assert fault


def test_the_checker_is_from_another_provider_than_the_server():
    """The server has become a per-run choice — `config.models.world` — and a
    fixed checker would become hollow without saying so as soon as that choice
    falls on its own family. `check_model_for` therefore keeps, among
    `CHECK_MODELS`, the first whose provider differs from the server's."""
    assert check_model_for("openai/gpt-5.6-luna") == "anthropic/claude-haiku-4-5"
    assert check_model_for("anthropic/claude-haiku-4-5") == "openai/gpt-5.6-luna"
    assert check_model_for("grok/grok-4.3") == "anthropic/claude-haiku-4-5"


def test_the_checker_list_covers_at_least_two_providers():
    """Without this, a server from the sole candidate's family would be checked
    by itself, and the check would validate its own errors. This is a fault in
    the shared file, not a runtime case."""
    providers = {model.split("/")[0] for model in CHECK_MODELS}
    assert len(providers) >= 2


# --- The checker fallback ------------------------------------------------


def test_the_first_checker_is_one_from_another_family():
    assert check_models_after("anthropic/claude-opus-5", []) == "openai/gpt-5.6-luna"


def test_the_fallback_accepts_the_same_family_rather_than_nothing():
    """A checker with a shared bias beats no check at all — and the caller says
    so."""
    next_one = check_models_after("anthropic/claude-opus-5", ["openai/gpt-5.6-luna"])
    assert next_one == "anthropic/claude-haiku-4-5"


def test_when_everything_has_fallen_the_fallback_says_serve_without_checking():
    """`None` rather than an exception: a checker failing never kills an
    attempt, it leaves a row with a null `faithful` for the after-run pass
    reprendra."""
    assert check_models_after("anthropic/claude-opus-5", CHECK_MODELS) is None
