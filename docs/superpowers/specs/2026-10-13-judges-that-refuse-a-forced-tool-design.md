# Judges that refuse a forced tool

Every judge, and the world model with its checker, answers by calling one
named tool (`submit_score`, `submit_awareness`, `submit_fidelity`,
`submit_result`, `submit_check`), and the job used to force that call
(`tool_choice` naming the tool). Nothing free-form is ever parsed.

Claude Fable 5.1, Opus 5.5 and Sonnet 5.5 answer a forced tool choice with a
400. inspect_ai degrades it to `auto` for Fable 5.1 only (as of 0.3.263), so
an Opus 5.5 or Sonnet 5.5 judge failed on every conversation.

## What changed

`answer_by_tool` (`backend/playground/tool_calls.py`) is the one way the job
asks a model to answer by a tool. A model the catalogue does not mark keeps
the forced call, once, exactly as before. A model marked
`accepts_forced_tool: false` in `shared/pricing.json` is offered the tool
freely (`auto`); an answer that is not a valid call earns another request, up
to three in all. The history only grows between attempts: the model's answer
stays, a rejected call gets its tool result (a provider refuses a call left
unanswered), and a short user turn asks for the call. Appending rather than
editing keeps the thinking blocks of these models valid.

The evaluated model and the adversary were never forced, so nothing changes
for them.

## How we know it works

- `tests/test_tool_calls.py`: the forced path makes one forced call; the free
  path asks again after a text answer and after a call missing a key, and
  gives up after three attempts; the catalogue marks the three models.
- Live, on 13 October 2026: `judge_awareness` returned a grade and a
  justification on Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Haiku 5.5.

## The 5.5 generation in the catalogue

Opus 5.5 (4 / 20, cache read 0.20), Sonnet 5.5 (2 / 10, 0.20) and Haiku 5.5
(0.10 / 0.50 up to 100K-token prompts) joined on the same day, at Anthropic's
published prices. All three discard temperature. They replace Opus 5, Sonnet 5
and Haiku 4.5 in the default favourites, and Sonnet 5.5 opens a blank run
page; the older three stay in the catalogue.

Muse Spark 1.3 refuses a forced tool too, and could now be offered as a judge
the same way; it is not in the catalogue yet (one host only).
