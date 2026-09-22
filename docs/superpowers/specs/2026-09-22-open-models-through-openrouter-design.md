# Open models, through OpenRouter

*22 September 2026*

## What changes

The catalogue gains DeepSeek, Kimi and GLM: eight models, reached through
OpenRouter on one key, `OPENROUTER_API_KEY`. That key already exists in
Secret Manager (polaris-dev), created for ai-character-index's job; this job now
mounts it too.

inspect_ai already speaks to OpenRouter: a model is written
`openrouter/<maker>/<model>`, and that identifier is what a run stores. No new
Python dependency: the provider rides on the `openai` SDK.

## The one decision: two named hosts per model, never a third

OpenRouter serves each of these models from fifteen to thirty hosts. Their
prices vary twofold, and many serve a compressed build (fp4, int4). By default
OpenRouter picks any host per call. For this product that is two faults at once:

- two repetitions of one cell can be answered by two different builds of the
  model, and the matrix then measures the routing;
- the price OpenRouter shows on a model is not what a given call is billed. For
  GLM 5.3 it shows 0.84 / 2.64 $/Mtok, while the hosts that actually served our
  calls bill 1.40 / 4.40.

So each model names its hosts in `shared/pricing.json` (`openrouter_hosts`),
and every call is sent with `provider: {order: hosts, allow_fallbacks: false}`:
the first host, the second when the first is saturated, and never a third. With
both down, the cell fails loudly with OpenRouter's error rather than being
answered by a host nobody checked. Checked live: GLM 5.3 Flash held to
`[fireworks]` alone failed with a 429; held to `[fireworks, together]`, it was
served by Together three times out of three.

**Why two and not one.** The first version held each model to a single host.
Hours later, OpenRouter's shared pool with Fireworks ran dry for four of the
models it served (`temporarily rate-limited upstream`,
`limit_source: upstream_provider_shared_pool`), while the same requests without a
pinned host went through at once. A lone host turns such a spell into cells
that retry until the job gives up. Every second host passed the same checks as
the first.

The first host is the maker's own when it passes the entry rule, Fireworks
otherwise, and Novita for DeepSeek V3.2, which Fireworks does not serve. The
maker's own failed twice:

| maker | what happened |
|---|---|
| DeepSeek | refused before any call: `Paid model training violation (account settings)`. DeepSeek trains on paid traffic, and the OpenRouter account excludes such hosts. That setting is the organisation's, shared with ai-character-index, and is not changed here. |
| Z.ai | answers ordinary tool calls, but refuses a forced one: `Tool choice must be auto, none, or required`. Every judge forces `submit_score`; a GLM judge would fail on every cell. |

OpenRouter does not disclose the precision of Fireworks or Together
("unknown"). Moonshot serves Kimi itself (mxfp4 for K3, int4 for K2.6, as
OpenRouter lists them); DeepInfra, Atlas Cloud and Novita list fp8 or leave it
unstated. No host on the lists is a declared fp4 or int4 build of a model its
maker ships at higher precision.

**The price is the higher of the two hosts'**, line by line (input, output, cache
read), so the cost recorded after a run never falls short of the bill. Where the
two hosts differ, a cell served by the cheaper one is slightly overcounted.

## The catalogue

Rule of entry, unchanged: a text model, that accepts tools, whose price is
published, and that really answered a tooled call made through inspect_ai.
Each model below answered, on each of its hosts, the three shapes the job sends:
a turn with a tool offered and a temperature, the next turn with the tool result
and the reasoning replayed, and a forced tool choice. The product's own
`run_conversation` (DeepSeek V4.1 Flash as the evaluated model, Kimi K2.6 as the
adversary) and `judge_conversation` (GLM 5.3, GLM 5.3 Flash, DeepSeek V4 Pro and
Kimi K3 as ordinary judges, GLM 5.3 Flash as the awareness judge) ran end to end.

Prices in $/Mtok, read from OpenRouter's endpoint list on 22 September 2026:

| identifier | label | hosts, in order | in | out | cache read | temperature |
|---|---|---|---|---|---|---|
| `openrouter/deepseek/deepseek-v4-pro-0813` | DeepSeek V4 Pro (0813) | fireworks, together | 1.32 | 3.96 | 0.13 | honoured |
| `openrouter/deepseek/deepseek-v4.1-flash` | DeepSeek V4.1 Flash | fireworks, deepinfra | 0.22 | 0.66 | 0.007 | honoured |
| `openrouter/deepseek/deepseek-v3.2` | DeepSeek V3.2 | novita, atlas-cloud | 0.269 | 0.40 | 0.1345 | honoured, see below |
| `openrouter/moonshotai/kimi-k3` | Kimi K3 | moonshotai, together | 3 | 15 | 0.30 | ignored |
| `openrouter/moonshotai/kimi-k2.6` | Kimi K2.6 | moonshotai, novita | 0.95 | 4 | 0.16 | ignored |
| `openrouter/z-ai/glm-5.3` | GLM 5.3 | fireworks, together | 1.40 | 4.40 | 0.26 | honoured |
| `openrouter/z-ai/glm-5.3-flash` | GLM 5.3 Flash | fireworks, together | 0.15 | 0.50 | 0.03 | honoured |
| `openrouter/z-ai/glm-5.2` | GLM 5.2 | fireworks, together | 1.40 | 4.40 | 0.26 | honoured |

What OpenRouter charges on top when credits are bought is not in these prices.

They sit in three groups, one per maker, rather than one "OpenRouter" group: the
group says whose model it is, and every group names `OPENROUTER_API_KEY` as its
key.

### Temperature

Measured, not read from documentation: four identical calls at temperature 0,
then one at 2.

- DeepSeek and GLM near-repeat themselves at 0 and return nothing usable at 2.
  The parameter arrives. GLM 5.3 still varied at 0 (four different sentences),
  so a sweep's low end on it is less flat than on DeepSeek.
- Kimi wrote four unrelated sentences at 0 and a sound one at 2. It discards the
  parameter without refusing the call: exactly the trap `honours_temperature:
  false` exists to name, and it now marks nine models instead of seven.
- DeepSeek V3.2 depends on its host. At 0, Novita, Atlas Cloud and GMICloud all
  vary somewhat from call to call; at 2, Novita and Atlas Cloud still write sound
  sentences (the top of the range is likely capped), and GMICloud refuses the
  value outright (`invalid_value`), which would fail every cell of a sweep that
  reaches 2. It stays marked as honouring the parameter, since the low end moves;
  a sweep on it is worth keeping below 1.
- **Above 1, the hosts of one model do not agree.** Together caps the top of the
  range on DeepSeek V4 Pro where Fireworks applies it, and refuses 2 on Kimi K3
  (`invalid_temperature`) where Moonshot ignores it; DeepInfra caps DeepSeek V4.1
  Flash where Fireworks applies it. GLM behaves alike on Fireworks and Together,
  and Kimi K2.6 alike on Moonshot and Novita. A sweep that goes above 1 on the
  DeepSeek V4 models or on Kimi K3 therefore measures, on the cells a second host
  served, the host as much as the model. Only 0 and 2 were measured, and at 0
  every host varied a little from call to call.

### DeepSeek V3.2, and the hosts it is held to

V3.2 is the model ai-character-index seats on its published panel. That index
reaches it through OpenRouter without naming a host, and prices it at 0.269 /
0.40, which is Novita's price. Every fp8 host tried (Novita, GMICloud, Atlas
Cloud, SiliconFlow) and DeepInfra's fp4 build passed the three shapes; Novita
was kept so the two products price the model alike, and for fp8, V3.2's native
precision, with Atlas Cloud second (fp8 too, slightly cheaper). GMICloud was
left out for refusing a temperature of 2. Its cache read is half its input
price, the highest ratio here.

Unlike the other seven, V3.2 does not reason by default: it answered with no
reasoning tokens at all.

### What stayed out

| left out | why |
|---|---|
| `deepseek-v4-pro` (0423), `deepseek-v4-flash` (0423, 0731) | superseded by 0813 and V4.1 Flash |
| `kimi-k2.5`, `kimi-k2-thinking` | no longer served by Moonshot |
| `kimi-k2.7-code` | a code variant, like `*-codex*` |
| `glm-5.3-flashx` | served by Z.ai alone, whose API refuses a forced tool choice (measured on GLM 5.3) |
| `glm-5v-turbo`, `glm-4.6v`, `deepseek-v4-flash-vision-exp` | vision variants |
| `*:batch`, `*:free` | separate offers with their own terms (`glm-5.2:free` has no tools and a 32k context) |

## Cache reads

`actual_cost` bills a cache read at 10 % of the input price, for every model.
Here the hosts bill from 3 % (DeepSeek V4.1 Flash) to 50 % (DeepSeek V3.2): the
shared multiplier would bill the first three times over and the second at a
fifth. Each of these prices therefore carries its own `cache_read_per_mtok`,
which `actual_cost` uses when present; absent, the multiplier applies as before.
None of these hosts bills cache writes.

The quote does not model the cache for any model, and still does not.

## The engine

`backend/playground/routing.py` holds the route, and `routed_model(name,
model_args)` replaces every `get_model(name, **model_args)` the job made:
target, adversary, world server, world checker, and the three judge kinds. A
call site that went back to `get_model` would lose the route silently; the
module's docstring says so.

The nominal model handed to `inspect_eval` is left as it was: it is never
called.

## Infrastructure (polaris-tf, separate PR on `develop`)

Two files, no new secret and no value to set:

1. `environments/app/evals_playground_batch.tf`: mount
   `google_secret_manager_secret.openrouter_api_key` as `OPENROUTER_API_KEY`.
2. `environments/app/service_accounts.tf`: add it to the `for_each` of
   `evals_playground_runner_secrets`, or the mount is denied at apply.

The secret stays declared in `ai_character_index_batch.tf`, where it was born.

Order: merge the polaris-tf PR and let the dev apply finish before this
repository's change reaches `main`. The other way round, the catalogue offers
the eight models while the job has no key, and every cell on them fails.

## What is not done

- **Only four join the default favourites**: the open models ai-character-index
  judges with. DeepSeek V3.2 holds a seat of its panel; Kimi K3 is the declared
  stand-in that took the Fable seat 14 times on 15 September 2026, when every
  Anthropic model was refused; Kimi K2.6 and GLM 5.2 are the stand-ins its
  configuration names for those two. The other four are in `/profile`, to tick.
  A profile with its own list keeps it: the default reaches only those who never
  chose.
- **Reasoning is not in the quote.** Seven of the eight reason before answering
  by default, and those tokens are billed as output. The quote does not model them
  for any model (Opus 5 already reasons), so the real cost of a run on these
  will sit above its quote.
- **The provider "family" is still the identifier's first segment**
  (`check_model_for`, `servedSummary`), which reads `openrouter` for all three
  makers. It matters only if an OpenRouter model becomes a world checker, which
  none is.
- **No change to the account's data policy.** Allowing DeepSeek's own servers
  would move the price of V4 Pro to 0.66 / 1.98, at the cost of DeepSeek
  training on the prompts; that is the organisation's call, not this change's.

## How we know it works

- Every `openrouter/` model names two hosts, no direct model names any, and
  each is built with exactly its route (`tests/test_routing.py`).
- A model with its own cache price is billed at it, one without keeps the
  multiplier (`tests/test_pricing.py`).
- Seven groups in order, the three OpenRouter ones on `OPENROUTER_API_KEY`,
  forty-nine models, nine that discard temperature (`web/lib/catalog.test.mts`).
- The default favourites end on ai-character-index's four open models
  (`web/lib/favorite-models.test.mts`).
- The live calls above, which are the entry rule itself, run on every host of
  every list.
