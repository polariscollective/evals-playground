# A run played elsewhere, read here

*13 October 2026*

## What changes

An agent outside the playground can play a run itself and hand the result over,
so the matrix, the judges, the exports and the public link all work on it as on
any other run. Nothing is played by our engine and nothing is spent by us.

The draft is the contract. The agent first deposits a draft with
`submit_draft_run` (or, later, `submit_draft_extension`), exactly as for a run
it would launch here: same validation, same catalogue, same favourites. Then,
instead of `launch_draft`, it calls `import_draft_results` with what it played.
The import fills what the draft declared, and nothing else.

What an imported run does not have:

- **no Inspect log.** The "View Inspect AI logs" item is already hidden when the
  bucket holds no `listing.json` for the run.
- **no measured cost.** The agent may declare one; see "Cost" below.
- **no token usage.** `usage` stays `{}`, which every reader already handles.

## A third origin

`eval_runs.origin` already says where a run was played: `local` or
`cloud-run`. It gains `external`. The list view already carries `origin`, so an
external run gets its own pill in the list with no new column. A filter on it
can come later.

Every job start rewrites `origin` today (`recordStart`). It stops doing so on an
external run, or the first catch-up pass would erase what the run is.

The check constraint on `origin` is widened by a migration in
`polaris-supabase` (`evals/supabase/migrations/`). Supabase CI does not apply
migrations at the moment: it is pushed by hand, and the schema snapshot
refreshed.

`launched_via` keeps saying who asked (`mcp`), independently of where the run
was played.

## Two tools

### `get_import_skeleton(draft_id)`

Starts nothing and spends nothing. Returns the JSON document
`import_draft_results` expects for this draft, every entry present and every
field to fill left empty. For a run draft it is one entry per cell. For an
extension draft it is the output of the same planner `launch_draft` uses
(`planExtension`), so the repetitions and conversations it names are exactly the
ones an extension launched here would have touched. There is no second way of
counting.

### `import_draft_results(draft_id, results)`

`results` is the filled skeleton, as a JSON string. What the tool does depends
on the draft's kind:

- **run draft**: revalidates the config (`configProblem`, favourites), then
  creates the run as `createRun` does (same cells, same judge links, same score
  rows), writes the imported content, and closes the run as `done` in the same
  request. The draft's tags pass to the run and the draft is marked launched.
- **extension draft**: allowed only on a run whose origin is `external`.
  Revalidates the request as `launch_draft` does (`extendProblem`,
  `extendTargetsProblem`, author only), applies it as `extendRun` does (same new
  cells, same reset of deepened attempts, same new judge links), writes the
  imported content, and closes the run as `done` again. The extension log gains
  its entry, `via: "mcp"`.

The budget caps do not apply: nothing is spent.

The run is never left `triggered` or `running`. The stale sweep would fail it
after two hours, and the page would poll a job that does not exist.

## The two doors stay apart

For now, a run is played entirely here or entirely elsewhere.

- `launch_draft` refuses an extension draft whose run is `external`.
- `import_draft_results` refuses an extension draft whose run is not.
- The web app's extend route refuses an `external` run, for the same reason as
  `launch_draft`.

One exception, deliberate: a judge added from the dashboard and then caught up
with the button grades stored conversations with our judge. That never replays a
conversation, it is a human gesture made in plain sight, and it is the only time
our engine touches an external run. Its cost is then the only measured cost on
the run (see below).

## The document

```json
{
  "cost_usd": 3.40,
  "cells": [
    {
      "scenario_index": 0,
      "target_model": "anthropic/claude-sonnet-5-5",
      "repetition": 0,
      "temperature": 0.7,
      "turns_done": 3,
      "messages": [
        { "role": "user", "content": "..." },
        { "role": "assistant", "content": "...", "tool_calls": [ { "id": "c1", "name": "lookup", "arguments": {} } ] },
        { "role": "tool", "content": "...", "tool_name": "lookup", "tool_call_id": "c1" }
      ],
      "cost_usd": 0.12,
      "grades": {
        "principal": { "score": 2, "justification": "..." },
        "awareness": { "score": 3, "justification": "..." }
      }
    },
    {
      "scenario_index": 0,
      "target_model": "anthropic/claude-sonnet-5-5",
      "repetition": 1,
      "error": "The provider refused the request after three retries."
    }
  ],
  "grades": [
    { "scenario_index": 1, "target_model": "...", "repetition": 0,
      "judge": "new_judges[0]", "grade": { "score": 1, "justification": "..." } }
  ]
}
```

### Cells

One entry per cell the draft declares (a run draft) or the extension adds or
deepens (an extension draft). Each one is either:

- **played**: `messages`, `turns_done`, and optionally `temperature` and
  `cost_usd`. The messages are the format `eval_samples.messages` already holds
  (`Message` in `web/lib/types.ts`): `content` a string, `tool_calls` entries with
  `id`, `name` and `arguments`. The system prompt is not repeated, it is read from
  the scenario. `turns_done` is required: a later deepening computes the turns
  left from it.
- **failed**: `error`, one sentence. The cell is stored as `error` with that
  text. Its score rows stay `pending`, exactly as when our engine fails a cell.

The skeleton also gives each cell its `temperature`, the one the draft planned.
It may be left as it is or removed, but a different value is refused.

For a deepened attempt, `messages` is the whole conversation, now longer, and
replaces the stored one.

### Grades

`grades` on a cell holds one entry per judge linked to the run, keyed as the
skeleton names them: `principal`, `awareness` and `adversary_fidelity` for the
system judges, and for any other judge `judges[i]` (its place in a run draft's
`judges`) or, on a run that already exists, the judge's slug.
Each entry is one of the three outcomes the run already keeps apart:

- `{ score, justification }`: graded. The score must be a value of that judge's
  scale, or the document is refused.
- `{ score: null, justification }`: nothing to grade.
- `{ error }`: the judge failed.
- `null`, as the skeleton leaves it: not provided.

A judge left out, or left `null`, of a played cell keeps its score row `pending`. That is how
an agent that does not run the awareness check hands the run over: the catch-up
button can then grade those rows with our judge, if someone chooses to.

The top-level `grades` list is for an extension that adds judges: one entry per
new judge per conversation already in the run, keyed `new_judges[i]`.

### Refusals

The document is refused whole, nothing written, when:

- an expected cell is missing, or a cell or grade is present that was not
  expected (the refusal lists them);
- a score is off its judge's scale;
- a cell is both played and failed, or neither;
- a message breaks the format above.

Since every write happens after these checks, a refusal costs a round trip and
nothing else.

## Cost

Optional, declared by the agent, never measured.

- A cell's `cost_usd` goes to `eval_samples.cost_usd`.
- A deepened cell's `cost_usd` is what deepening it cost, not the whole
  conversation: the run already counts the turns played before. The cell then
  stores its earlier cost plus that one, unknown when either is.
- A deepened attempt that fails without a declared cost keeps the cost it had:
  a failed attempt with no cost contributes nothing, and an unknown earlier cost
  stays unknown.
- The document's `cost_usd` is the cost of this import. Absent, it is the sum of
  every cell's declared cost, failed cells included, when every played cell
  carries one, and unknown otherwise. With no played cell and no declared
  total it is unknown too, even when failed cells declare costs.
- The run's `cost_usd` is the sum of its imports' costs. Unknown plus anything
  stays unknown (`null`): a partial sum would read as the whole.
- An extension's log entry records `cost_before_usd` as usual, so an imported
  extension's cost reads the same way as a launched one's.

A catch-up pass run by our engine on an external run adds its measured cost to
the declared one, as `finish_run` already does from `run.usage`. When the
declared cost is unknown, the run's cost stays unknown.

The run page says the cost was declared when the run is `external`.

## Where the code goes

- `web/lib/import-results.ts`: parsing and checking the document against the
  expected entries, pure, and the expected entries themselves built from a run
  draft's cells or from an extension's plan. Tested on its own.
- `web/lib/runs.ts`: `importRun` and `importExtension`, which reuse
  `createRun`'s and `extendRun`'s writes rather than copy them, then write
  messages, grades and costs, and close the run.
- `web/app/mcp/route.ts`: the two tools, and the refusal in `launch_draft`.
- the web extend route: the refusal on `external`.
- `backend/playground/batch_job.py`: `finish_run` keeps an external run's
  cost unknown when it was unknown before a catch-up pass, instead of replacing
  it with the pass's own spend.
- `read_format`: one section on importing.
- the migration, in `polaris-supabase`.

## Tests

- the checker: missing and extra cells, a played and failed cell, a score off
  the scale, an unknown judge key, a malformed message;
- the skeleton of an extension draft matches `planExtension` for new cells,
  deepened attempts and new judges;
- the cost rules, including unknown plus known;
- the two doors: `launch_draft` refuses an external extension,
  `import_draft_results` refuses a local one;
- the engine: a catch-up pass on an external run with an unknown cost leaves
  it unknown (pytest).
