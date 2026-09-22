"""The real cost of a run, and the price of a cache read."""

from playground.eval_schemas import ModelUsage
from playground.pricing import CACHE_READ_MULTIPLIER, PRICES, actual_cost


def test_a_model_with_its_own_cache_price_is_billed_at_it():
    # DeepSeek V4.1 Flash reads its cache at 0.007 $/Mtok, 3 % of its input
    # price: the shared 10 % would bill that line three times over.
    name = "openrouter/deepseek/deepseek-v4.1-flash"
    cost, unpriced = actual_cost(
        {name: ModelUsage(input_tokens_cache_read=1_000_000)}
    )
    assert unpriced == []
    assert cost == PRICES[name].cache_read_per_mtok == 0.007


def test_a_model_without_one_keeps_the_shared_multiplier():
    name = "anthropic/claude-opus-5"
    assert PRICES[name].cache_read_per_mtok is None
    cost, _ = actual_cost({name: ModelUsage(input_tokens_cache_read=1_000_000)})
    assert cost == PRICES[name].input_per_mtok * CACHE_READ_MULTIPLIER
