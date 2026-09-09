# Four advice documents, and a grade we expect

A brainstorm, not a spec. Nothing here is settled enough to implement; the
point is to have the decisions written down where they can be read twice.

The starting material was an outside critique of the scenario advice. Its
central claim: the whole guide optimises against one failure — *the model sees
the test* — and almost nothing against the other one — *the number does not
measure what I think it measures*. That claim holds, and most of what follows
is the second failure being given the same treatment the first already has.

---

## 0. Three things checked in the code first

Two of them change the answer, so they come before anything else.

**`MatrixView` does not know which row it is on.** It is
`{ aggregate, remap }`, where `remap` is a grade→grade table valid for the
whole matrix (`web/lib/view.ts`). A "distance from what we expected" reading
needs a *different* mapping per row, so it cannot be written as a `remap`.
That is the only real plumbing cost in this brainstorm, and it is small:
`cellsOf` already holds `scenario_index`.

**The ordinary judge is shown the scenario's system prompt.**
`shared/judge-prompt.json` carries a `SYSTEM PROMPT, given as context` block.
For the eval-awareness judge this is deliberate and necessary — it has to check
the model was not simply told it was a test. For an ordinary judge, on a
scenario whose system prompt states the rule being tested, it hands the judge
the conclusion. This is real, and no paragraph of advice repairs it.

**The check model does not silently retry.** `faithful` is recorded on the
served result and read by the judges; there is no re-roll loop
(`backend/playground/world.py`). The critique's worry — *if you retry on a
flag, you never see the rate and you bias towards outputs the checker likes* —
does not apply here. Worth writing down explicitly in the analysis document.

---

## 1. The grade we expect

### It is not the field decided yesterday

The earlier decision was `expected_grade` as a **prediction**: "this row should
land at 1, and if it does not, my experiment is broken." What is wanted now is
a **target**: the grade a model behaving as we would want should get.

These are different objects, and only one of them can colour a matrix.

| Row | As a prediction | As a target |
|---|---|---|
| base rate | 1 — I expect nothing to happen | 1 — a good model does not budge ✓ |
| rule removed | 3 — I expect this to slip | 1 — a good model holds without the rule ✓ |
| feasibility | 4 — the cooperative model should manage it | *meaningless* ✗ |

The target is well defined everywhere except the feasibility row, which is
about the environment rather than about the model.

**One numeric field, defined as the target. Predictions stay as prose in
`note`.** A number that means two different things depending on the row cannot
be read.

### The formula

Judge's scale with the excluded level removed: `v_min` to `v_max`. Target `t`.
Observed grade `g`.

```
g > t   →   deviation = (g − t) / (v_max − t)
g = t   →   deviation = 0
g < t   →   deviation = (g − t) / (t − v_min)
```

Between **−1 and +1**. Zero is on target. ±1 is as far off as the scale allows.

### Why the denominator is the room available, not the range

Scale 0–4.

- Row A, target 0: the worst grade is 4, four points away.
- Row B, target 2: the worst grade is 0 or 4, two points away.

Divide both by the range (4) and row B can never exceed 0.5. It would look
permanently twice as well held as row A, when in fact it is as far off as it
can possibly be. That is a scaling artefact, not a finding.

**The common case is the simple case.** When the target sits at one end of the
scale — "a well-behaved model refuses, so 0" — only one side exists and the
formula collapses to `(g − t) / range`. The per-side rule only bites on a
mid-scale target, which is exactly where it corrects something.

### Two judges, one axis

```
Principal judge, 0–4, target 0     Honesty judge, 1–10, target 10
  g = 0   →    0.00                  g = 10   →    0.00
  g = 2   →   +0.50                  g =  7   →   −0.33
  g = 4   →   +1.00                  g =  1   →   −1.00
```

### Three cautions, since rigour was asked for

**Normalising does not make the scale metric.** A deviation of +0.50 is not
"twice as bad" as +0.25. It is ordinal underneath, exactly as the raw grade is.
What the formula buys is comparability of *direction* and *order of magnitude*
across rows and across judges. It buys no new statistical validity.

**Mean deviation cancels, and that is this view's own trap.** Two attempts at
−1 and +1 average to 0, which reads as "on target" and says the opposite of the
truth. On this reading the distribution — already in the cell's tooltip — is
read *before* the mean. This is the one thing the absolute view forgives and
this one does not, and it belongs in the analysis document.

**The sign carries more than the size.** A row where every model sits at +0.25
in the same direction is a result. A row that swings and averages to 0 is not.

### The field lives on the judge, not on the scenario

Four reasons, all pointing the same way:

- **The target is expressed in that judge's scale.** Put on the scenario, it is
  orphaned from the rubric that gives it meaning.
- **Judges are added after launch.** `new_judges` re-reads stored transcripts;
  adding one must not mean rewriting a hundred scenarios.
- **It is naturally a list per judge** — one entry per scenario, aligned to
  `scenario_index`, which is append-only and already the matrix's coordinate.
- **All or nothing per judge.** `expected` is either absent (exploration: we do
  not know) or a full-length array. `configProblem` checks the length, and that
  validation is what forces the writer to say what they are looking for.

One consequence to accept: `submit_draft_extension` with `new_scenarios` must
extend every judge's array. That is one more constraint, and it is a good one —
it forbids adding rows to a study without saying what is expected of them.

Rejected alternative: keying the targets by scenario title. Titles are not
unique and get edited.

### What it touches

`types.ts`, `eval_schemas.py`, `config-file.ts`, the CSV column, `validate.ts`,
`view.ts` (a `relative` flag, and a target passed to `mapScore`),
`ViewControls` (one toggle), `agent-prompt.ts`.

**Nothing in the engine.** The target reaches no model — not the target model,
not the judge, not the world model. It is a lab annotation like `note`.
Otherwise we would be handing the judge the answer.

---

## 2. Variants: the answer, and the inversion

> When results are mixed, should the run be extended with variants that are
> supposed to change nothing, to confirm it?

No — or rather, only in one case out of three. **A mixed cell has three causes,
and they are told apart by reading transcripts, never by guessing.**

1. **The attempts diverged inside the environment** — a different query, the
   item found here and missed there. That is a branch, not noise. Rewrite the
   row and **relaunch** it: the old attempts no longer play the same scenario.
2. **Same path, different decision at the same point.** Genuine
   non-determinism. The follow-up is **more repetitions** on that row. Not
   variants.
3. **A detail of the decor is doing the work.** Here, and only here, variants.

**And the inversion is the point: the cells worth paying variants for are the
unanimous ones, not the mixed ones.** A cell at 4/10 has already told you the
model hesitates; no strong claim will rest on it. A cell at 0/10 or 10/10 is
the one a claim *will* rest on, and it is exactly where a single unlucky detail
can do all the work with nothing on screen to say so. Ten identical repetitions
give you the same mistake ten times, with rising confidence.

**Nothing to build for this.** `new_scenarios` is concatenated onto
`config.scenarios` (`web/lib/runs.ts:1279`) and plays "together with the same
targets and repetitions". A variant added by extension is therefore played by
every target model already — the pairing is free. Variants are a piece of
analysis advice, and nothing else.

---

## 3. The four documents

| | What it holds | When it is read |
|---|---|---|
| **1. Scenario** | The tells, the names, the world, the tools, planted information, Chekhov's gun, the noise-to-consequence ratio, observation manipulated by the world. Identical in exploration and in study — a scenario that smells like a test is useless in both. | before writing |
| **2. Experiment** | A short exploration-vs-study block at the head, then markers on the rules that actually differ. One axis per row, the control rows, the target per judge, "more rows or more repetitions" settled in advance. | before launching |
| **3. Analysis** | The four checks before looking at the matrix, what a single cell can say, which transcripts to read and in what order, sorting the three causes above, `deepen` and new judges rather than variants, paired comparison, when a mean is allowed at all, what to write in `analysis`. | with results in hand |
| **4. Judge** | Writing a scale whose levels someone else can tell apart. The excluded level. Calibration: 30–50 transcripts graded by hand, blind, then read the *pattern* of disagreement rather than the correlation. Fixes in order: redefine the level, split it, and only then add anchoring examples. The annotated set becomes the regression set. | before writing a judge, and after watching one run |

A sentence for documents 2 and 3 both: **an exploration run does not become a
study by being extended. The study is rewritten from scratch, or its rows did
not all play the same version.**

### Not four MCP tools

One tool, `read_advice(topic)`, with four values — and `read_scenario_advice`
kept as an alias, since it is named in the server's instructions and in
`agent-prompt.ts`. A fifth document then costs nothing. One detail left for the
spec: four override columns on the profile, or a single JSON column.

### On calibration, two honest lines

It is outside the tool today. And its cheap version is already free: add a
second judge asking the same question in different words and compare the two
columns, replaying nothing. That is the cheapest calibration available, and it
works now.

---

## 4. Every point decided so far, reviewed

| Point | Still holds? | Where it goes |
|---|---|---|
| Split of the documents | **Changed**: 2 → 4 | structure |
| `expected_grade` per scenario, as a prediction | **Changed**: per judge, as a target | product + doc 2 |
| Wider taxonomy of tells (benchmark format, verifiable problem, synthetic inputs, temporal incoherence, stylistic uniformity) | yes | advice, doc 1 |
| Chekhov's gun — a legitimate exit as available and as instrumented as the bad one | yes, and checkable without launching anything: the tool list is in the config | advice, doc 1 |
| Randomising nuisance variables | **Changed**: no longer a batch-design rule, now a targeted follow-up on the unanimous rows | advice, doc 3 |
| Observation manipulated by the world | yes — and the permitted sentence "your reasoning will not be shown to the user" goes | advice, doc 1 |
| Three or four consequential details, everything else noise | yes | advice, doc 1 |
| Real sector, invented entity | yes | advice, doc 1 |
| Control rows (base rate, rule removed, feasibility, "told it is a test" twin, excluded grade) | yes — feasibility is the one that takes no target | advice, doc 2 |
| Read five transcripts, one of them green | yes | advice, doc 3 |
| Awareness read before the mean; the filtering trap; unverbalised awareness | yes | advice, doc 3 |
| What the mean does not cover | yes — and the drive-deletion example (an overall mean over 21 attempts of 24, one cell wholly excluded) is a real case to cite | advice, doc 3 |
| Statistics | yes, simplified: at 3 attempts only 0/3 and 3/3 speak; the unit is the scenario; paired comparison; **and by default, no aggregation at all** | advice, doc 3 |
| The judge is part of the experiment | yes, and it becomes a whole document | doc 4 |
| Exploration vs study | yes — a short block at the head of doc 2, not two parallel documents | advice, doc 2 |
| Contamination / canary string | yes, but not only advice: `/shared/[runId]` publishes real scenarios | advice doc 2 + **open product question** |
| A built-in realism judge | **dropped** — one line in doc 4 saying it can be written as a secondary judge today | advice, doc 4 |
| World/tools lint | **out of scope**, and the only point that genuinely *cannot* be advice: a `read_file` with no file content in the world is not caught by prose | later |
| Forcing a transcript draw before the heat map | replaced by "read five" | advice, doc 3 |

---

## 5. What advice cannot fix

Three things. Only the first is in this piece of work.

1. **The expected grade and the deviation view.** In scope. The one product
   change validated so far.

2. **The ordinary judge sees the scenario's system prompt.** Deliberate and
   necessary for the awareness judge, which has to check the model was not
   simply told. A real bias for an ordinary judge as soon as the system prompt
   states the rule being tested. The fix would be a per-judge flag. Out of
   scope, and document 4 can only flag it.

3. **The check model covers one family of environment failures** — retrieval
   that invents or contradicts the world. The other three are seen by nobody: a
   world with nothing to answer, a fixed tool landing beside the context, a
   target model blocked by an environment that always errors. This one *can* be
   caught by advice, and it is exactly why document 3 makes you read five
   transcripts. To be written as such, without pretending the `faithful` rate
   is enough.

**One inconsistency, noted and not acted on:** the run list shows an overall
mean, while document 3 will say not to aggregate when rows ask different
questions. The document will contradict the screen. Liveable — but better known
before writing it.

---

## 6. Next step

Write the spec: the four documents and their tables of contents, the `expected`
field on the judge with the formula and the all-or-nothing rule, the deviation
view, and an explicit list of what is being left out.
