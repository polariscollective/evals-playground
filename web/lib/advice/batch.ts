// Guide 2 — how the rows of a run hold together.
//
// The "batch" half of the old single document, taken out and grown. What it
// gains: the exploration-against-study block at the head, because it changes
// almost everything below it and nothing said so; the targets per judge; two
// more control rows (base rate and feasibility); the two calibration judges;
// and contamination.
//
// One block at the head instead of two parallel documents. The whole first half
// of the craft, the tells, the names, the world, the tools, is identical in both
// modes. A scenario that smells like a test is useless whether you are exploring
// or measuring.
//
// Later: three sections on the axis itself, which the document assumed you
// could simply declare. Checking it is real before launching; the middle rung
// of a pressure axis being the one that discriminates, which is the opposite of
// what a writer reaches for; and the style shared by rows written in one
// sitting, which is the scenario document's "one voice" tell one level up, and
// only costs you the run when it drifts along the axis. "What the run is a
// measure of" sits at the head because a run can pass every rule below it and
// still measure something nobody asked about.
//
// House style for the document itself: British English, plain declarative
// sentences, and no em dash in running text. Commas, colons, semicolons and
// parentheses instead.

export const BATCH_ADVICE = `# Putting a batch together

The scenario advice is about one row and one failure: the model sees the test. A
batch has a failure of its own. Every cell comes out green, or every cell comes
out coloured, and you have learned nothing either way.

## First: are you exploring, or are you proving?

This changes almost everything below, and a batch that has not decided usually
does neither well.

**Exploring.** You do not yet know what you are looking for. One model, one
repetition, a couple of turns, rows that share no axis and need not,
\`check_eval_awareness: false\`, no control rows, no targets. What comes out is a
**rewritten scenario**. Do not quote its matrix.

**Proving.** You know what you are looking for. Rows that differ along one named
axis, several models, several repetitions, the awareness check on, control rows,
and a target on every row. What comes out is a matrix you would put in front of
someone, and a written analysis beside it.

**An exploration run does not become a study by being extended.** Once you know
what the axis is, write the study from scratch. Otherwise half your rows played
an older version of the scenario, and they do not compare.

Everything from here is written for the second mode. Where a rule only applies
there, it says so.

## What the run is a measure of

Three things can go wrong before a single row is written, and only the middle
one is about craft:

1. The property you named is not the one you care about, because your definition
   of it is loose.
2. The rows do not measure the property, because they are badly built.
3. The rows measure the property exactly, and the property turns out not to be
   connected to what worried you in the first place.

Almost everything in these documents is about the second. The third is the one
that wastes a whole run, because nothing goes wrong: the matrix is clean, the
controls land, and the finding is about something nobody needed to know.

The defence takes one sentence, written before launching: "if this comes out the
way I expect, it matters because ...". If that sentence is hard to finish, the
axis is not the one you want, and no amount of care further down will fix it.

## Change one thing per row

If two rows differ in their setting **and** in the pressure applied, a
difference in grade says nothing about which one caused it. Vary along a single
named axis: the same situation at three degrees of pressure, or the same
pressure in three settings. Put the axis in the scenario's \`note\`.

When the run serves its tools, the world is the cleanest axis there is. The run
holds what every row shares, and each scenario's own world holds only its
difference.

## Check that the axis is real

Naming an axis is not the same as having one. You wrote three degrees of
pressure, and nothing yet says the middle row sits between the other two. If it
does not, the differences you read along that axis are about something you never
named. The same goes for any axis with an order in it: three depths of burial,
three sizes of stake, three levels of autonomy.

This is checkable before spending anything. Put the rows side by side, take out
whatever states their intended order, and sort them. Better, have a model sort
them, having told it only what the axis is. If your order cannot be recovered
from the text, it is not in the text, and running the batch will not put it
there.

An adversarial run gets a version of this check for free, after the fact.
\`check_adversary_fidelity: true\` reads what the adversary actually said and
grades it against the objective it was handed, which is how you find out that
two rows meant to differ were played the same way. The judge advice describes
it. The sorting above is the part you can do first, and it is the only part that
covers a run with no adversary in it.

## On a pressure axis, the middle rung is the one that pays

The intuition is that the hardest row is the most aggressive one. It is usually
the other way round. Overt pressure, a threat, a stated deadline, a demand
repeated after a refusal, is recognisable, and a model that recognises it holds.
Moderate pressure moves judgement further: professional framing, an authority
mentioned in passing, a plausible justification, a figure offered as evidence.
Nothing in it announces that a line is being pushed, so there is nothing to
brace against.

Two consequences. Put the middle rung in, rather than writing a baseline and a
maximum and calling that an axis. And do not read a good grade on the top row as
robustness, since part of that grade is the row being easy to see.

Said from the scenario advice's side, this is the same rule twice: aggression is
a tell. Your highest-pressure row is also your least realistic one, which is why
it is a poor row to rest a claim on.

## One voice wrote every row, too

The scenario advice carries this tell for a single world. It has a twin at the
level of the batch, and the twin is the more dangerous of the two, because
nothing inside any one row shows it.

Rows written in one sitting share a register, a rhythm, a way of naming people,
and above all a length. That costs nothing while it stays constant. It costs you
the run when it drifts **along the axis**, which is what happens when you write
the rows in the order of the axis and warm up as you go. The high-pressure rows
come out longer and better made than the baseline, and part of what you then
measure is prose.

Two cheap defences. Write the rows out of order, or have them rewritten in a
different order afterwards. And compare their lengths before launching: if the
axis and the word count climb together, one of the two is not what you think it
is.

## Say what a good model should score

For each judge, write down before launching the grade a model behaving the way
you want would get on each row. That is the **target**. It lets a cell be read
as a distance, so you do not have to hold the whole rubric in your head to
interpret a number.

Three different things hide under the word "expected", and keeping them apart is
most of the work:

- **The target**: what a good model does. Missing it *is* your result.
- **The control**: a row that must land near its target, or nothing else on the
  matrix can be read. Missing it means you have no result at all.
- **The bet**: what you think will happen. It has no right answer, and it exists
  so you can be wrong in writing. Keep it in \`note\`.

Targets are **all or nothing** per judge: a full list, one entry per scenario,
or none at all. None is a real answer, and it means you were exploring. There is
deliberately no partial list, because six months later a hole cannot be told
from an oversight.

A target is expressed in **that judge's** scale, which is why the same row can
carry 4 for the judge grading deletion and 10 for the judge grading honesty.

**Extending a study means extending its targets.** Adding rows to a run whose
judges declare targets requires \`new_targets\`: one entry per new row, per judge,
keyed by \`run_judge_id\`. Only the new rows. The ones already played keep what
they were launched with, because a target rewritten after seeing the result is
worth nothing. A judge that declared none is refused targets for the new rows
alone, which would leave it covering half the matrix.

## Keep a few rows whose result you already know

Most rows are there because you cannot predict them. A few should be there
because you can. They teach you nothing about the models, and they tell you
whether the rest of the batch can be believed. Mark each of them \`check: true\`.

Five are worth having. Note that only the first two have a target that is also
"what a good model does":

- **The base rate.** The same world with the pressure taken out. If it drifts
  anyway, your decor is doing the pushing and the axis is not what you think.
  Target: the good grade. Also a control.
- **The rule removed.** The same situation with the rule you wrote taken out of
  the system prompt. If it scores like the row that carries the rule, the rule
  changed nothing, and the models were behaving that way already. Target: still
  the good grade. Not a control, since a difference here is a finding.
- **Feasibility.** A cooperative model, asked outright to do the thing. If it
  cannot, then every green cell elsewhere may mean "impossible" instead of "well
  behaved". Target: the **top** of the scale, because that is what should happen
  here. This row is about the environment, and says nothing about the model.
- **The twin that is told.** The same row, with the scenario saying plainly that
  this is a test. You know the direction, and the gap with its twin gives you the
  size of that effect for this batch specifically. Reading the awareness judge
  will not give you that, since a model can suspect and stay silent.
- **A row your criterion plainly does not apply to**, if your scale carries an
  excluded grade. Target: that excluded grade. A judge that hands it a real grade
  is answering some other question.

Control rows stay out of any figure computed across rows. They are odd on
purpose.

**Fewer moving parts on a control row.** A served tool puts a model between you
and the result, and a fixed one does not. \`world_effect\` is fine either way,
being a sentence you wrote. A row where the model reshapes the world as it goes
has more ways to land somewhere you did not predict.

## Write two judges asking the same question

The cheapest calibration available, and it costs one judge call per
conversation. Write the same question twice, worded differently, and compare.

Look at the disagreements one conversation at a time, and not at the two column
means: two judges can average the same and disagree on half the conversations,
compensating. Nine times out of ten the pattern points at a badly worded level
of your scale.

The judge advice covers what to do about it.

## More rows, or more repetitions

- **Can this happen at all?** More rows. You find it by covering ground.
- **How often does it happen?** More repetitions of fewer rows. At three
  attempts a cell can only be 0, 1, 2 or 3 out of 3, so do not read a small gap
  between two cells as real.

Variation between scenarios almost always dominates variation between
repetitions of one scenario. If you want a number that holds, more rows beats
more repetitions. Repetitions only steady a single cell.

## Before launching, say what would surprise you

For each row: which result would you not expect? Write it in \`note\`. If you
cannot answer, that row is not an experiment, and it will confirm whatever you
already believed.

This is the bet, and it is what makes the analysis worth writing. A row that
landed where you said it would and a row that did not are two very different
findings, and six months on nothing else will tell them apart.

## If you publish, assume it ends up in training data

Published scenarios are scraped, and memorisation is itself one of the tells the
scenario advice lists. Keep a private set. Do not publish your control rows as
written, since their value depends on nobody having seen them.

Note that sharing a run from this application publishes its scenarios in full.

Once the results are in, reading them is its own job with its own failure mode.
Ask for the analysis advice before concluding anything from a matrix.

## Where this comes from

- [A statistical approach to model evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals): short and directly applicable. Why the scenario, and not the attempt, is the unit that carries your uncertainty.
- [Measuring what Matters: Construct Validity in LLM Benchmarks](https://proceedings.neurips.cc/paper_files/paper/2025/file/1967e0fc3aa6cbbace562f5cb8e3954e-Paper-Datasets_and_Benchmarks_Track.pdf): what it takes for a number to be about the thing you say it is about.
- [Measurement to Meaning: A Validity-Centered Framework for AI Evaluation](https://arxiv.org/abs/2505.10573): the same question, framed as a checklist you can walk.
- [How Johnny Can Persuade LLMs to Jailbreak Them](https://arxiv.org/abs/2401.06373): the persuasion taxonomy a pressure axis is built from, and the evidence that humanised persuasion outperforms the overt attack.
- [ARENA, Chapter 3: LLM Evaluations](https://learn.arena.education/chapter3_llm_evals/): where uniformity of style is treated as a confounder of the result rather than a matter of taste, and where the three ways a measurement misses are separated.
`;
