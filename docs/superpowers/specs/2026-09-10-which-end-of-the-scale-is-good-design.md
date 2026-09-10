# Which end of the scale is good

10 September 2026.

## The problem

Nothing records the direction of a judge's scale. The format asks for scales
written with the wanted behaviour at the top, the matrix paints the top olive
and the bottom rust, and the two agree by convention.

The convention holds for a judge somebody writes. It breaks for the two built
in: eval awareness alarms at 10, adversary fidelity alarms at 1. So neither can
be shown as a grid — one would paint the alarming cells olive, the other the
reassuring ones rust — and the run screen offers no view on them at all. That is
the visible cost today: a run carries three judges and only one of them can be
looked at as a matrix.

## What we are building

A judge says which end is good. One column, `higher_is_better`, true by default
and therefore true for everything already stored, false on the awareness judge.

It belongs to the judge, beside the scale it reads, and not to the link: the
same judge reused on another run reads the same way, or it is not the same
judge.

## What it changes, and what it does not

It changes a **reading**. The heat ramp flips for a judge that alarms high, and
so does any sentence calling a number good or bad.

It changes no **measurement**. A grade is what the judge returned, a mean is
still the mean of the grades, and the distance to a target was already signless:
landing three above what a well-behaved model should score is as much of a miss
as landing three below.

Consequence worth stating, because it is the one thing a reader could expect and
not get: two judges pointing opposite ways still cannot be averaged together.
The flag makes their colours comparable, not their numbers.

## The freeze

A judge that has graded cannot have its question, scale, scope or visibility
changed: the runs it graded show them as their own, and editing them would
rewrite what those runs say they measured.

`higher_is_better` stays outside that freeze, deliberately. It says how to read
grades rather than what was graded, and a direction written the wrong way round
must be fixable in place rather than by copying a judge that is otherwise
correct.

## Where it shows

- **The matrix.** The displayed judge's direction decides the ramp. A judge that
  alarms high paints its 10 rust and its 1 olive.
- **The run screen.** The built-in judges become viewable like any other, since
  the thing that stopped them is now recorded rather than assumed.
- **The form.** A checkbox under the scale, on by default, saying in one line
  that it decides how the results are coloured and read.
- **The format and the connector.** One optional field, and the judge identity a
  run read already returns carries it.

## What does not move

The engine never reads it: it grades, it does not colour. The stored
configuration carries it like the rest of what describes a judge, so a run keeps
saying how it was meant to be read.
