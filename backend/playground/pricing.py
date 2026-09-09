"""Model prices, and the real cost of a run.

The *quote* — what the run will cost, estimated before launching it — no longer
lives here: it lives in `web/lib/pricing.ts`, and nowhere else. It was written
in Python first (`88f90ef`), then ported to TypeScript when the application
moved to Next.js (`ef60372`); the Python copy stayed put without ever being
called again by the engine, and every change to the quote raised the question of
porting it once more. It left rather than answer that question again — see
`docs/superpowers/specs/2026-09-08-devis-par-role-design.md`.

What remains genuinely runs in the job: the price table, and `actual_cost`,
which prices the tokens actually consumed once the run has played. No
assumptions here, then: only counters reported by the providers.

The prices are those read on 19 August 2026 from the four providers'
documentation. They change: `shared/pricing.json` is the only place to update.
"""

from dataclasses import dataclass

from playground.eval_schemas import ModelUsage
from playground.shared_data import load

_SHARED = load("pricing")
"""Prices, calibrations and catalogue, shared with TypeScript.

The values below are pulled from it rather than written here: it is the only way
the quote the interface shows and the cost the job computes cannot drift apart.
Changing them is done in `shared/pricing.json`.
"""


@dataclass(frozen=True)
class ModelPrice:
    """A model's price, in dollars per million tokens."""

    input_per_mtok: float
    output_per_mtok: float


PRICES: dict[str, ModelPrice] = {
    name: ModelPrice(price["input_per_mtok"], price["output_per_mtok"])
    for name, price in _SHARED["prices"].items()
}




CACHE_READ_MULTIPLIER = _SHARED["cache_read_multiplier"]
CACHE_WRITE_MULTIPLIER = _SHARED["cache_write_multiplier"]
"""Relative prices of cached input tokens.

All four providers bill a cache read at 10 % of the input price — checked for
Google too, which only joined the catalogue after this note was written for the
other three. Anthropic bills a write at 25 % more than ordinary input; OpenAI,
xAI and Google do not bill writes at all, and so report zero on that counter —
the formula stays correct for them.

One nuance specific to Google, and only to the models `PRICES` carries at their
*promotional* price rather than at the *standard* input price the 10 % applies
to: `gemini-3.8-flash`, `gemini-3.7-flash` and `gemini-3.6-flash` sit here at
$0.75/Mtok, a promotion running until 31 December 2026, rather than at their
standard $1.50/Mtok. During the promotional window, a cache read on those three
therefore costs around 20 % of the price this table carries, and `actual_cost`
undercounts that line for them until the promotion expires. `gemini-3.5-flash`,
at the same standard $1.50/Mtok, does not have the nuance: the 10 % is exact
there. The gap stays small and bounded, and is not corrected here: there is
nothing to change in the coefficient itself, 10 % remains correct for the other
three providers and will become correct again for those three models once their
promotion ends.

Without these coefficients the real cost would be wrong in both directions:
inspect counts cache tokens separately from `input_tokens`, so ignoring them
undercounts and billing them at full price overcounts.
"""


def actual_cost(usage: dict[str, ModelUsage]) -> tuple[float, list[str]]:
    """Real cost in dollars, computed on the tokens actually consumed.

    No assumptions here, unlike the quote (`web/lib/pricing.ts`): the counters
    come from inspect's log, which holds them from the providers' own responses.

    Returns:
        The cost, and the list of models with no known price. An unknown model
        is not silently billed at zero: the caller has to decide what to show, a
        partial total being misleading.
    """
    total = 0.0
    unpriced: list[str] = []
    for model, counts in usage.items():
        price = PRICES.get(model)
        if price is None:
            unpriced.append(model)
            continue
        total += (
            counts.input_tokens * price.input_per_mtok
            + counts.input_tokens_cache_read
            * price.input_per_mtok
            * CACHE_READ_MULTIPLIER
            + counts.input_tokens_cache_write
            * price.input_per_mtok
            * CACHE_WRITE_MULTIPLIER
            + counts.output_tokens * price.output_per_mtok
        ) / 1_000_000
    return total, sorted(unpriced)
