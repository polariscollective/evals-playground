# Reusing a judge

10 September 2026.

## The problem

Judges became a library yesterday (`20260910090000_judges_become_a_library.sql`,
polaris-supabase). The data model has said since then that a judge is shared and
a link is per-run: `run_judges` points at a judge, several runs can point at the
same one, and the model that grades belongs to the link.

Nothing in the product does it. The form, the configuration file and the
connector all mint a fresh judge from the criterion they are given. Two runs
asking the same question hold two judges, and the library fills up with
near-duplicates nobody can tell apart.

The system judges show the same seam from the other side. Their rows are minted
at launch like any other, so the adversary-fidelity judge does not exist at all
until somebody launches a run with its box ticked — it is missing from the
library today — and the next launch will write `Eval awareness (2)` beside the
row the migration had just deduplicated.

## What we are building

**A judge can be named instead of described.** Everywhere a judge is written
today — the principal, the extra judges, the judge added to a run already
launched — a handle may stand in its place. Named, the judge is reused as it
stands. Described, it is created, and colliding names keep being numbered.

**The system judges are seeded.** One row per type, created by a migration, with
a fixed handle. A launch links them; it never mints them.

## What belongs to the judge, what belongs to the run

The split already exists in the tables, and this work makes the screens obey it.

| belongs to the judge | belongs to the link |
|---|---|
| question, scale, whose turns it grades, what it is shown | the model that grades, what it expects of each scenario, principal or not |

A reused judge therefore arrives with its question and its scale fixed, and they
are shown read-only. The grading model and the per-scenario expectations stay
editable on every run, reuse or not.

## The configuration

One new field, at two levels:

    judge: honesty-about-deletions     # the principal, instead of criterion + rubric

    judges:
      - judge: did-it-check-first      # an extra judge, named
      - criterion: ...                 # an extra judge, described
        rubric: [...]

`judge` and `criterion` are mutually exclusive, at both levels. So are `judge`
and the other fields that describe a judge: `rubric`, `label`, `grades`,
`sees_adversary_goals`, `sees_system_prompt`. `model` and `targets` remain
allowed beside a handle, because they belong to the link.

Refused, each with a sentence saying what to do instead:

- a handle and a description in the same entry;
- a handle no judge answers to;
- a system judge's handle in `judges` — its checkbox is what turns it on;
- the same judge named twice on one run;
- a reused judge that grades the adversary on a single-turn run, which is
  today's rule applied to a judge that arrives already made.

Existence is checked where the database is at hand: at launch, when adding a
judge to a run, and when a draft is submitted, which is the free validation an
agent leans on.

## The system judges

A migration inserts the missing `faithful_adversary` row and adopts the `awake`
row that already exists, then closes the question with a partial unique index:
at most one row per system type in the whole table. `judgesForLaunch` stops
minting them and links the seeded rows by their type, which are read and handed
to it the way the taken names already are. A launch that cannot find them fails
saying the migration has not run, rather than quietly writing a second one.

Consequence, and the reason this sits in the same piece of work: the library
shows both built-in judges from the migration onwards, whether or not either has
ever graded anything.

## The form

Everything about judges moves into one block: the principal, the extra judges,
and the two built-in ones, which come up from the bottom of the page where they
sat next to the cost estimate.

Each judge block offers two ways: write a new question, or reuse one that
exists. The list offered holds ordinary judges only, since the built-in two have
their own checkbox a few lines below. Picking one fetches it whole — the list
carries no criterion on purpose — shows its question and scale read-only, and
leaves the model and the expectations alone.

The estimate keeps counting one judge call per graded conversation. A reused
judge is priced on the text the form just fetched, so the quote says the same
thing whether the question was typed or picked.

## The connector

No listing tool. A run read already carries everything about its judges, so the
handle is added there, and the format documentation says how to name it on the
next run. An agent that liked how a run was graded reuses its judges by reading
it.

## What does not move

The engine reads links and judges from the database and cannot tell a reused
judge from a fresh one. The quote counts one call per judge per conversation, as
before. A judge that has graded stays frozen, and reusing it changes nothing
about that: the freeze is on its question, not on its use.

## Two repositories

The migration lives in `polaris-supabase`, under `evals/supabase/migrations/`.
Everything else lives here.
