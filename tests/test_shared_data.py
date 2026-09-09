"""The contract of `shared/`: what Python and TypeScript must read alike."""

import json

import pytest

from playground.eval_schemas import RubricLevel
from playground.pricing import PRICES
from playground.scoring import JUDGE_SYSTEM, score_prompt
from playground.shared_data import SHARED_DIR, load

RUBRIC = [
    RubricLevel(value=0, meaning="Nothing delivered."),
    RubricLevel(value=2, meaning="Everything delivered."),
]


def test_the_shared_files_are_valid_json():
    for name in ("pricing", "judge-prompt"):
        assert isinstance(load(name), dict), name


def test_the_path_does_not_depend_on_the_working_directory():
    # The job starts from /app inside its container, the tests from the root.
    assert SHARED_DIR.is_absolute()
    assert (SHARED_DIR / "pricing.json").exists()


def test_a_missing_shared_file_fails_outright():
    # A job that refuses to start beats a job that bills at the wrong price, or
    # that sends the judge a prompt which is not the right one.
    with pytest.raises(FileNotFoundError):
        load("does-not-exist")


# --- the prices --------------------------------------------------------------


def test_the_python_constants_really_come_from_the_file():
    shared = load("pricing")
    assert PRICES["anthropic/claude-opus-5"].input_per_mtok == (
        shared["prices"]["anthropic/claude-opus-5"]["input_per_mtok"]
    )


# --- the judge prompt --------------------------------------------------------


def test_the_template_carries_its_four_slots():
    template = load("judge-prompt")["user_template"]
    for slot in ("{criterion}", "{transcript}", "{rubric}", "{values}"):
        assert slot in template, slot


def test_the_system_message_comes_from_the_file():
    assert JUDGE_SYSTEM == load("judge-prompt")["system"]


def test_the_rendering_puts_each_thing_in_its_place():
    """This test is the contract the TypeScript port has to reproduce.

    The preview shown before a launch and the prompt actually sent to the judge
    are rendered by two different languages from the same template. If they
    drifted apart, the interface would describe a prompt that no longer exists,
    and nothing would report it.
    """
    rendered = score_prompt("A_TRANSCRIPT", "A_QUESTION", RUBRIC)

    assert "A_QUESTION" in rendered
    assert "A_TRANSCRIPT" in rendered
    assert "- `0` — Nothing delivered." in rendered
    assert "- `2` — Everything delivered." in rendered
    assert "exactly one of these values: `0`, `2`" in rendered
    # The question is delimited, so that an instruction slipped into it is not
    # confused with the judge's own instructions.
    assert rendered.index("<instructions>") < rendered.index("A_QUESTION")


def test_the_levels_are_rendered_in_grade_order():
    out_of_order = [RUBRIC[1], RUBRIC[0]]
    rendered = score_prompt("T", "Q", out_of_order)
    assert rendered.index("- `0`") < rendered.index("- `2`")


# --- the prices, in full -----------------------------------------------------


def test_every_price_in_the_file_arrives_whole_in_the_table():
    """The smoke test proving Python really reads `shared/pricing.json`.

    It bore on `estimate_cost` while Python still knew how to estimate; the
    estimate now lives in `web/lib/pricing.ts` alone (see
    `playground.pricing`'s docstring), and the guarantee is now obtained on
    `PRICES`, which remains. Do not let this test go with what it used to cross:
    without it, a malformed shared file would only show up on the first billed
    run.
    """
    shared = load("pricing")["prices"]
    assert set(PRICES) == set(shared)
    for name, price in shared.items():
        assert PRICES[name].input_per_mtok == price["input_per_mtok"], name
        assert PRICES[name].output_per_mtok == price["output_per_mtok"], name
