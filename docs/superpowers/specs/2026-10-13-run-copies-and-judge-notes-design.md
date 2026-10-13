# Run copies, and named judge notes per scenario

We evaluate how closely models follow published constitutions. Two needs:

- **Grade again without replaying.** A conversation already played can be
  graded again, by another judge or with more precise instructions for one
  scenario, without paying the evaluated model again.
- **Reuse one run's conversations in another.** A common-base run plays the
  same situations for every model. From it we derive, for each company, a run
  of its own: its model and the situations that concern it, then its own
  scenarios and a judge that quotes its exact text.

Three changes, and nothing else.

## 1. Copying a run

A copy is a new, independent run made from any existing run, whole or reduced
to a subset of scenarios × target models × judges × repetitions. It holds:

- the configuration, restricted to the subset: scenarios (with their judge
  notes), target models, world, tools, run notes;
- the live judges kept, their links (model, targets restricted to the kept
  scenarios, judge note) and their grades;
- the conversations exactly as played (messages, tool calls, `turns_done`),
  each cell's usage, cost, status and error;
- the served tool results (`tool_results`) of the kept scenarios, so that an
  extension stays consistent with the conversations copied.

Afterwards it is an ordinary run: judges can be added or unlinked, a catch-up
run, and it can be extended. Nothing links it to its source but three columns:

- `copied_from`: the source run's id (`on delete set null`);
- `copy_scope`: `{ scenarios, target_models, run_judge_ids, repetitions }`,
  where `scenarios[i]` is the source index of the copy's scenario `i`;
- `money_saved`: the summed cost of the copied cells, what replaying them
  would have cost.

**Origin.** The copy inherits its source's origin and never changes it: a
copy of a run the playground played is extended with `launch_draft`, a copy
of an imported run by import. The existing rule, a matrix is played in one
place, applies unchanged, through `run.origin`.

**Cost.** The copy's `cost_usd` starts at the copied cells' cost, and
`money_saved` says the same sum, shown beside the cost on the run page so
nobody believes it was paid twice. Unknown (`null`) as soon as a finished
copied cell has no known cost; a failed cell with none costs nothing, as
everywhere else. Judge spending on the source is not a cell cost and is not
carried.

**Decisions made here.**

- The principal is always copied: a run cannot exist without one.
- A run still being played (`triggered`, `running`) is not copied.
- Scenarios keep the source's order and are renumbered from 0; repetitions
  too. The copy's status is its source's.
- Any signed-in person may copy any run (reading is open); the copy is theirs.
- The configuration is rebuilt from the judges kept, so Duplicate on the copy
  does not bring back a judge the copy left out.
- Written by the application in slices; a failure halfway sets the
  half-written copy aside (`deleted_at`).

**Access.** "Copy with results…" on a run's page (`POST /api/runs/:id/copy`),
and the MCP tool `copy_run(run_id, scenario_indices?, target_models?,
judges?, repetitions?, label?)`, judges named by `run_judge_id` or slug. Both
spend nothing and return the new run's address, the MCP tool with the index
mapping.

## 2. Named judge notes per scenario, append-only

A scenario carries `judge_notes: { <name>: <text> }`. A name matches
`[a-z0-9-]+` and is unique within a scenario.

**A note is never changed or removed.** Notes live in `eval_runs.config`, on
their scenario. They are added through the database function
`eval_runs_add_judge_notes(run, name, { index: text })`, which takes a row
lock, refuses a malformed name, an index outside the run, an empty text, or a
name one of the scenarios already carries, and writes nothing on refusal. A
trigger refuses any update of `config` that would change or remove a note, by
any door, an extension's rewrite of the config included.

They are written in a draft's YAML, per scenario, or added to an existing
run, even finished: "Add judge notes…" on the run page
(`POST /api/runs/:id/judge-notes`) and the MCP tool `add_judge_notes`
(restricted to the run's creator, like every MCP write). A copy carries the
notes of the scenarios it keeps.

`read_advice("judge")` says how to write one: which passage applies and which
concrete behaviour matches which level, never the grade expected (that is the
target, which no judge sees).

## 3. A judge link chooses at most one note

`run_judges.judge_note` holds a note name or null. It is set when the judge is
linked and never changed (a trigger refuses it); another note means another
judge linked. System judges cannot carry one (a check constraint).

**Grading.** When the playground grades a conversation with a judge whose
link names a note, and that conversation's scenario carries a note of that
name, the text is appended to the criterion as
`\n\nFor this conversation: <text>` (`shared/judge-prompt.json`,
`scenario_note_template`). Without such a note on the scenario, nothing is
added. This happens in `judges_scorer`, which every grading path goes
through: launch, extension, catch-up, and a judge added to a run already
played. The run page's prompt preview shows the note for the scenario
displayed (`criterionWithNote`, the TypeScript twin).

**Where it is chosen.** In the YAML, `judge_note: <name>` on the principal
(top level) or on an entry of `judges`, named or described; on a judge added
to an existing run, in the application and in MCP (`new_judges[].judge_note`).
A name no scenario of the run carries is refused, so a typo cannot pass
silently. `get_run_metadata` returns each judge's `judge_note`, and
`judge_notes`: each name with the scenarios carrying it.

## Out of scope

Changing or removing a note; changing a run's origin; lifting "a matrix is
played in one place"; judges limited to some scenarios. The composition form
(and so Duplicate) does not carry judge notes; the YAML path does.

## Rollout

The migration `20261013160000_eval_runs_copies_and_judge_notes.sql`
(polaris-supabase) is applied before the application is deployed: the engine
selects `run_judges.judge_note`, and a select naming a missing column fails
the whole read.

## How we know it works

- The migration, on a scratch Postgres loaded with `schema.sql`: adding a
  note, refusing a taken name atomically, refusing edits and removals,
  appending scenarios, the `run_judges` checks and the freeze.
- `web/lib/run-copy.test.mts`: whole and reduced copies, grades and notes
  travelling, targets and tool results renumbered, the cost rules, the
  principal kept, refusals.
- `web/lib/judge-notes.test.mts`, `config-file.test.mts`,
  `launch-judges.test.mts`, `live-config.test.mts`: names, choices, the YAML
  round trip, links carrying their note.
- `tests/test_scoring.py`: the note appended on the scenario that has it,
  nothing elsewhere, nothing for a judge without one, and the field crossing
  the metadata boundary; `web/lib/judge-prompt.test.mts` for the twin.
