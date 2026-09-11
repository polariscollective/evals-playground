# An adversary, and the turns it needs

10 September 2026.

## The problem

Two halves of one rule, and neither of them is written down.

**A run can carry an adversary that never speaks.** `configProblem` requires an
adversary model and an adversary prompt as soon as `turns` is above 1, and says
nothing at all below it. The form never produces that state — `app/page.tsx`
sends `adversary: null` and `adversary_prompt: ""` whenever `turns` is 1 — so
the screen looks like it holds the rule. It does not hold it: the same document
sent through the connector, or pasted into the form, keeps both fields, and they
are written onto a run where the adversary is never called. A setting with no
effect, read back a month later as if it had counted for something. It is the
same fault this repository already refuses for `models.world`, in those words:
*a setting with no effect is worse than an absent one*.

**A run of one turn can never be deepened.** `extendProblem` refuses a depth
above 1 when the run names no adversary, and an extension has no way of naming
one. The panel's Depth field accepts 2 on a single-turn run all the same, and
the server answers with a sentence about a field the panel does not show. The
only way out today is to write the run again from scratch and pay for the whole
matrix a second time.

## Half one: an adversary at one turn is refused

`configProblem` gains the other side of the rule it already carries. A filled
`models.adversary` or a filled `adversary_prompt` on a configuration whose
`turns` is 1 is refused, in one sentence that says why and gives the two ways
out: raise the turns, or drop the two fields.

Empty stays accepted, and that is what keeps the form working untouched: `null`
and `""` are what it already sends at one turn, and `config-file.ts` already
reads an empty `models.adversary` as absent.

The refusal lands on every door at once, because they all pass through
`configProblem`: the form, the pasted document, the CSV file, `submit_draft_run`
and `update_draft_run` on the connector, and the launch of a draft — a draft
already saved with that pair becomes unlaunchable, and says so.

### What we deliberately do not do

The mirror in `backend/playground/eval_schemas.py` is **not** written. Its
`_adversary_required_beyond_one_turn` stays exactly as it is.

The Python model validates configurations read back out of the database, not
documents arriving from outside. A run recorded before today with that stray
pair runs perfectly well — the engine never calls the adversary at one turn —
and adding the refusal there would make it unrelaunchable and un-re-judgeable,
breaking work already paid for over a setting that does nothing. The rule
belongs at the door, and the door is `configProblem`.

## Half two: an extension may define the adversary

`ExtendRequest` gains two fields, `adversary` (the model that plays the user)
and `adversary_prompt` (its objective). They travel together: a definition is
both, or it is nothing.

The rule is the world model's rule, transposed. Three cases, and the third is
the one worth stating:

- **The run has no adversary and this extension raises the depth above 1.** Both
  fields are required. This is the case the whole work exists for.
- **The run already has an adversary.** It is not changed, and naming either
  field is refused outright — not only a different one. Two adversaries inside
  one run would make its cells incomparable, which is the one thing a matrix
  cannot survive, and the run's own would silently win over what was sent:
  validated, never applied, which is the failure this repository has already met.
  The world model allows the harmless repetition because the panel may send it;
  here the panel never does, `needsAdversary` being false in exactly that case.
- **The run has no adversary and this extension does not raise the depth above
  1.** Naming one is refused. It would never be called, and a setting with no
  effect is worse than an absent one.

`resolvedAdversary(config, request)` carries the rule once, for the three
callers that need the answer: the write, the quote, and the screen. The run's own
always wins; the request only ever fills a gap. It lives in `lib/adversary.ts`,
the counterpart of what `resolvedWorld` is to `lib/tools.ts`, and it resolves the
model and the objective as a **pair** — the run's model beside the request's
objective would push at something nobody ever set it to push at.

### What the extension writes

`extendRun` writes `models.adversary` and `adversary_prompt` into the run's
configuration in the same update that already advances `turns`, for the reason
that update already gives: a depth that moved without anything saying who now
pushes would be half a piece of information.

Once written, the adversary belongs to the run. It plays every cell the
extension adds, every attempt the extension continues, and everything a later
extension replays. That is deliberate and it is the reason it cannot be changed
afterwards.

### The quote

An extension's price is computed on the run as it stands. A run with no
adversary prices its adversary at nothing, which is right today and wrong the
moment this extension introduces one: the added turns each call a model that the
quote does not count, and the figure shown before confirming is too low.

So the configuration handed to `estimateExtension` carries the resolved
adversary, exactly as it already carries the resolved world. Both sides, because
there are two: `planExtension` in `lib/runs.ts`, which records the quote, and
`ExtendPanel`, which announces it. Two computations of the same thing have
already drifted here by a factor of three, and the fix was to give them one
function; this change must not give them two configurations instead.

`adversary_prompt` is resolved with the model and not separately. `estimateCost`
counts its tokens on every push, so an objective missing from the priced
configuration understates the input of every adversary call.

## Where it shows

- **The extension panel.** Two fields, a model and an objective, shown when the
  run has no adversary and the Depth field has been raised above 1. Hidden
  otherwise, as the run's own adversary is already hidden at one turn.
  `needsAdversary(config, turns)` decides both the display and whether the
  request carries the pair, one predicate for the two questions — the shape
  `needsWorldModel` already has, and for the reason written in
  `lib/extend-request.ts`: when those two answers came from two expressions, the
  screen demanded a field it then left out of the request, and the server
  refused with the very message that had sent the user there.
- **The connector.** `submit_draft_extension` takes `adversary` and
  `adversary_prompt`, described as required together when raising a single-turn
  run, and inherited and unchangeable when the run already has one.
- **The format manual.** `read_format` states the refusal at one turn beside the
  requirement above one, since today it states only the second. The extension
  tool's own description carries the extension side.
- **The run's extension history.** An extension that defines the adversary says
  so, on one line, beside the depth it moved to. The record already carries it;
  `summariseExtension` only has to read it.

## The neighbouring hole, closed on the way

`extendProblem` validates a judge added to a run without telling
`judgeSpecProblem` the run's depth, so `judgeGradesProblem` falls back to its
default of 2. A judge added to a single-turn run may therefore declare that it
grades the adversary, or that it sees the adversary's objective, on a run where
the adversary never speaks. It would read a conversation holding nothing it is
meant to grade, and grade it anyway.

The run's real depth is passed. The same refusal that already applies when the
run is written now applies when a judge is laid on it afterwards.

## Tests

`npm --prefix web test`, since all of this is TypeScript. `pytest` is untouched
and must stay green.

- `configProblem` refuses a filled adversary model at one turn, refuses a filled
  objective at one turn, and accepts both empty.
- `extendProblem` on a single-turn run: refuses a raise to 2 with no definition,
  accepts it with both fields, refuses one field without the other, refuses a
  definition when the depth does not rise, and refuses a different adversary on a
  run that already has one while accepting the identical one.
- `resolvedAdversary` returns the run's over the request's, and the request's
  only into a gap.
- `buildExtendRequest` carries the pair exactly when `needsAdversary` is true.
- `estimateExtension` prices the adversary's calls on an extension that
  introduces it, both for added cells and for continued attempts.
- A judge added by an extension to a single-turn run, declaring that it grades
  the adversary, is refused.
