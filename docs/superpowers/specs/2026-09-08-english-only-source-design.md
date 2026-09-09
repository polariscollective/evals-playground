# English-only source

The repository is written in French throughout — docstrings, comments, a few
hundred identifiers, and a handful of user-facing strings. The workspace
`CLAUDE.md` says everything written into a repository is English. This brings
the repository in line with its own rule.

## What is French today

Measured by lines carrying an accented character, which is a floor rather than
a total: unaccented French lines exist.

| zone | lines | what it is |
|---|---|---|
| `web/lib` | 5 481 | comments, doc comments, a few identifiers |
| `backend/` | 1 750 | dense module and function docstrings |
| `tests/` | 1 177 | test names, fake classes, local constants |
| `web/app` | 1 052 | comments, a few visible tooltips |
| `web/components` | 800 | comments |
| `docs/superpowers/` | 6 339 | 41 specs and plans |
| root config, `docs/DEPLOY.md` | ~80 | comments |

Identifiers were extracted with real parsers — `ast` for Python, the
TypeScript compiler for the rest — not with a regular expression over comments.
635 were flagged on the Python side (roughly 500 in `tests/`), 345 on the
TypeScript side, the latter including false positives such as `auth`, `cwd`,
`usd` and `haiku`. Representative real ones: `offerts`, `ajoutés`, `affecte`,
`configRésolu`, `draftsDuPerimetre`, `depuisJson`, `TROIS_RÔLES`,
`OUTIL_SERVI`, `ModeleQuiRefuseLaLecture`, `_echelle_valide`.

## Out of scope

**`docs/superpowers/**`.** 41 specs and plans, 6 339 lines — the largest single
block. It is a dated record of past work, the same kind of artefact as a commit
message, and nothing is written into it any more. Leaving it French halves the
job and loses nothing that is still read as instruction.

**`web/public/inspect-view/**`.** Vendored build output, MathJax among it. Not
ours to rewrite.

**Commit messages and existing branch names.** Historical record, same
reasoning as the specs.

## Deleting the legacy scenario playground

`data/judges/` holds five judge rubrics — `realism`, `specificity`,
`non_obvious`, `seed_fidelity`, `no_test_leak`, all tagged `qualite_scenario`.
They grade the quality of a generated scenario, not the behaviour of an
evaluated model, and they belong to an earlier product.

They are unreachable. The Cloud Run image runs `python -m playground.batch_job`
(`Dockerfile`), and `trigger.ts:69` spawns the same module in development.
Only `playground.job` loads those rubrics, and nothing launches it. The proof
is stronger still: the `Dockerfile` copies `backend/` and `shared/` and nothing
else, so `data/` never enters the container at all.

Removing the five files forces a chain, each link existing only for the one
before it:

- `judges.py` (156 lines) — loads them, and does nothing else.
- `job.py` (182 lines) — imports `load_judge`.
- `judging.py` (226), `store.py` (208), `schemas.py` (72) — reachable from
  `job.py` and from nowhere else.
- In `generation.py`, everything but `tool_call_arguments`:
  `GENERATION_SYSTEM`, `generation_dataset`, `submit_scenario`,
  `scenario_solver`, `axis_for_index`, `_axis_instruction`, `_prompt`,
  `VARIATION_AXES`. Only `tool_call_arguments` has live callers, in `world.py`
  and `scoring.py`.
- Tests: `test_judges`, `test_pipeline`, `test_judging`, `test_store`,
  `test_schemas`, `test_thresholds` go entirely; `test_generation` shrinks to
  what covers `tool_call_arguments`.

`catalog.py` (98 lines) and its test go with them, by a different route: it is
reachable from neither entry point, `web/lib/catalog.ts` is the live catalogue,
and `web/lib/catalog.test.mts` already asserts the same two pricing invariants
— every offered model has a price, no price is orphaned. Nothing is lost.

**One reference must move rather than die.** `batch_job.py:592`,
`scoring.py:636` and `eval_task.py:127` all point at the docstring of
`scenario_solver` to explain why `model_args` is threaded explicitly. That
explanation has to land somewhere live before `scenario_solver` is deleted;
three live modules citing a deleted symbol would be worse than the French.

That is roughly 2 600 lines removed, 341 of them French that will not need
translating.

## Prompts

Model-facing prompts are already English, with one exception:
`shared/adversary-prompt.json`. It carries the confidentiality notice wrapped
around the objective the experimenter writes, twice — before and after — plus
the line naming the opening message. It is used on every multi-turn run
(`conversation.py:210`).

It becomes English. This does break comparability with archived runs, which was
accepted deliberately: a French envelope around an English objective is a worse
problem than a discontinuity in the series.

The five judge rubrics are not translated. They are deleted.

## The interface

Navigation is already English — "Evaluate", "Runs", "Scenarios",
"Connections". What remains French reads as oversight rather than decision: a
few `title=` tooltips, one heading in `eval/[runId]/page.tsx`, and the
sentences `extension-summary.ts` builds at runtime with a French pluraliser
("3 essais", "2 juges"). All of it becomes English, and the interface becomes
consistent.

## Known gap, not addressed here

A run does not show the prompt that was actually sent. The run page displays
`config.adversary_prompt` under "Adversary objective" — the experimenter's own
text — never the assembled system prompt with its envelope. Judges have the
same gap: `job.py` re-read the rubric file at run time and the run kept no
record of the text used; `batch_job` stores the criterion and scale in
`judges`, but not the rendered prompt.

Worth fixing, and not a translation. Showing the assembled adversary prompt
needs no storage — the envelope is a static file. Showing the rubric a judge
actually used needs it recorded at run time, which means a migration in
`polaris-supabase`. Separate work.

## Delivery

One branch, `english-only`. One pull request. One commit per zone, in this
order:

| # | commit | contents |
|---|---|---|
| 0 | delete the legacy scenario playground | the chain above, plus `catalog.py`; the `scenario_solver` note relocated |
| 1 | `backend/` | docstrings and identifiers |
| 2 | `tests/` | test names, fixtures, fake classes |
| 3 | `web/lib` | comments, identifiers, and the French sentences it builds |
| 4 | `web/app`, `web/components` | comments, identifiers, tooltips, headings |
| 5 | prompts and config | `adversary-prompt.json`, `Dockerfile`, `pyproject.toml`, CI, `.env.example`, `docs/DEPLOY.md` |

The identifiers are not a commit of their own, as an earlier draft of this
section had it. A rename crosses zone boundaries — renaming an export in
`web/lib` forces edits in `web/app` — but the crossings turned out to be few and
local, and a single repository-wide rename commit would have been unreadable and
unbisectable. Each zone therefore carries its own renames, and the compiler
catches a crossing left behind before the commit is made. Each zone was in
practice cut into several commits, one per batch of files, for the same reason.

All the risk sits in commit 0 and in the renames; both are checked by the two
suites, run after every batch.

## Verification

`pytest` and `npm --prefix web test` after commits 0 and 1, and again at the
end. `npx tsc --noEmit` and eslint after the TypeScript commits. A translated
comment cannot break a build, but a renamed identifier can, and a mis-edited
string inside a template literal can.

Two checks specific to this work:

- No accented character survives outside `docs/superpowers/`,
  `web/public/inspect-view/`, and text that is deliberately French.
- The identifier extraction is re-run at the end, and what it flags is either
  English or a known false positive.

An accent grep is not enough on its own, and that was learnt the hard way: a
whole class of French carries no accent (`Les journaux d'Inspect, lus dans
Supabase Storage.`), and an accent-only sweep declares such a file clean. The
second detector looks for French function words that are not English words —
`qui`, `dans`, `sans`, `chaque`, `jamais` — and one hit is enough. It found some
five hundred lines the first sweep had walked past.

GNU/BSD `grep` is not to be trusted for this either. `web/app/page.tsx` carried a
stray NUL byte inside a template literal used as a React key; BSD `grep` treats
such a file as binary and silently matches nothing in it, so the file read as
clean while holding twenty-seven French lines. Both detectors are therefore
written in Python, which decodes the file itself. The NUL was replaced by an
ordinary `|` separator along the way.
