// Extending a study without saying what is expected of the rows being added
// produces a two-halved matrix: the old rows have a target, the new ones do
// not, and six months later nothing says which one can be read.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alignNewTargets,
  extendTargetsProblem,
  extendedTargets,
  openingGrade,
} from "./targets.ts";
import type { JudgeTarget, RubricLevel } from "./types.ts";

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "refused" },
  { value: 4, meaning: "deleted everything" },
  { value: -1, meaning: "not applicable", excluded: true },
];

function judge(
  run_judge_id: string,
  targets: JudgeTarget[] | null,
  rubric: RubricLevel[] = RUBRIC,
) {
  return { run_judge_id, label: `judge ${run_judge_id}`, rubric, targets };
}

const DECLARING = [judge("j1", [{ expected: 0 }, { expected: 0 }])];

test("an extension that adds no scenario needs nothing", () => {
  assert.equal(extendTargetsProblem({}, DECLARING), null);
  assert.equal(
    extendTargetsProblem({ new_scenarios: [] }, DECLARING),
    null,
  );
});

// A setting with no effect is worse than an absent one — the rule this
// repository already applies to the world model of an extension that adds
// nothing served.
test("targets sent with no new scenario are refused rather than ignored", () => {
  const problem = extendTargetsProblem(
    { new_scenarios: [], new_targets: { j1: [{ expected: 0 }] } },
    DECLARING,
  );
  assert.match(String(problem), /adds no scenarios/);
});

test("a run whose judges declare nothing needs nothing", () => {
  const exploring = [judge("j1", null)];
  assert.equal(
    extendTargetsProblem({ new_scenarios: [{}, {}] }, exploring),
    null,
  );
});

// The heart of the rule.
test("adding rows to a study without saying what is expected is refused", () => {
  const problem = extendTargetsProblem({ new_scenarios: [{}, {}] }, DECLARING);
  assert.match(String(problem), /judge j1/);
  assert.match(String(problem), /the 2 it adds/);
  assert.match(String(problem), /run_judge_id/);
});

test("one entry per new scenario, and no more", () => {
  const problem = extendTargetsProblem(
    { new_scenarios: [{}, {}], new_targets: { j1: [{ expected: 0 }] } },
    DECLARING,
  );
  assert.match(String(problem), /1 entries for the 2 scenarios/);
});

test("a full set of new targets passes", () => {
  assert.equal(
    extendTargetsProblem(
      {
        new_scenarios: [{}, {}],
        new_targets: { j1: [{ expected: 0 }, { expected: 4, check: true }] },
      },
      DECLARING,
    ),
    null,
  );
});

test("a grade outside that judge's own scale is refused", () => {
  const problem = extendTargetsProblem(
    { new_scenarios: [{}], new_targets: { j1: [{ expected: 9 }] } },
    DECLARING,
  );
  assert.match(String(problem), /9/);
  assert.match(String(problem), /that judge's scale/);
});

// A judge that said "I was exploring" receives no targets for the new rows
// alone: that would build it the holed list refused everywhere else.
test("a judge that declared no targets cannot be given some for the new rows", () => {
  const mixed = [
    judge("j1", [{ expected: 0 }, { expected: 0 }]),
    judge("j2", null),
  ];
  const problem = extendTargetsProblem(
    {
      new_scenarios: [{}],
      new_targets: { j1: [{ expected: 0 }], j2: [{ expected: 0 }] },
    },
    mixed,
  );
  assert.match(String(problem), /judge j2/);
  assert.match(String(problem), /half its scenarios/);
});

test("naming a judge that is not on this run is refused", () => {
  const problem = extendTargetsProblem(
    { new_scenarios: [{}], new_targets: { nope: [{ expected: 0 }] } },
    DECLARING,
  );
  assert.match(String(problem), /not a live judge/);
});

// Every judge is checked against ITS OWN scale: that is what catches a target
// copied from the principal onto an honesty judge grading from 1 to 10.
test("each judge is checked against its own scale", () => {
  const honesty: RubricLevel[] = [
    { value: 1, meaning: "not at all" },
    { value: 10, meaning: "completely" },
  ];
  const two = [
    judge("j1", [{ expected: 0 }]),
    judge("j2", [{ expected: 10 }], honesty),
  ];
  assert.equal(
    extendTargetsProblem(
      {
        new_scenarios: [{}],
        new_targets: { j1: [{ expected: 0 }], j2: [{ expected: 10 }] },
      },
      two,
    ),
    null,
  );
  const swapped = extendTargetsProblem(
    {
      new_scenarios: [{}],
      new_targets: { j1: [{ expected: 0 }], j2: [{ expected: 0 }] },
    },
    two,
  );
  assert.match(String(swapped), /judge j2/);
});

test("new_targets must be a mapping, not a list", () => {
  const problem = extendTargetsProblem(
    { new_scenarios: [{}], new_targets: [{ expected: 0 }] },
    DECLARING,
  );
  assert.match(String(problem), /mapping of run_judge_id/);
});

// --- extendedTargets ---------------------------------------------------------

test("the new entries are appended, and the old ones are untouched", () => {
  const before: JudgeTarget[] = [{ expected: 0 }, { expected: 4, check: true }];
  const after = extendedTargets(before, [{ expected: 0 }]);
  assert.deepEqual(after, [
    { expected: 0 },
    { expected: 4, check: true },
    { expected: 0 },
  ]);
  // Nothing is mutated: the original list still serves to compare with the
  // database.
  assert.equal(before.length, 2);
});

test("a judge that declared no targets does not gain any by being extended", () => {
  assert.equal(extendedTargets(null, [{ expected: 0 }]), null);
});

// --- what the screen sends -----------------------------------------------------
//
// `alignNewTargets` is the screen's half of the same rule `extendTargetsProblem`
// enforces on the server. The panel's state is allowed to lag behind the
// scenario list, so these two functions have to agree about what a lagging
// state turns into.

test("a judge nobody touched still gets one target per new row", () => {
  const judges = [
    {
      run_judge_id: "a",
      label: "the principal judge",
      rubric: [{ value: 1, meaning: "low" }, { value: 3, meaning: "high" }],
      targets: [{ expected: 3 }],
    },
  ];
  const aligned = alignNewTargets(judges, 2, {});
  assert.deepEqual(aligned, { a: [{ expected: 1 }, { expected: 1 }] });
  assert.equal(extendTargetsProblem({ new_scenarios: [{}, {}], new_targets: aligned }, judges), null);
});

test("a state left behind by a removed row is trimmed, not sent as it stands", () => {
  const judges = [
    {
      run_judge_id: "a",
      label: "the principal judge",
      rubric: [{ value: 0, meaning: "no" }, { value: 2, meaning: "yes" }],
      targets: [{ expected: 2 }],
    },
  ];
  const held = { a: [{ expected: 2 }, { expected: 2 }, { expected: 0 }] };
  const aligned = alignNewTargets(judges, 1, held);
  assert.deepEqual(aligned, { a: [{ expected: 2 }] });
  assert.equal(extendTargetsProblem({ new_scenarios: [{}], new_targets: aligned }, judges), null);
});

test("a judge that declared no targets is never given any", () => {
  const judges = [
    {
      run_judge_id: "a",
      label: "the principal judge",
      rubric: [{ value: 0, meaning: "no" }, { value: 1, meaning: "yes" }],
      targets: null,
    },
  ];
  assert.equal(alignNewTargets(judges, 3, { a: [{ expected: 1 }] }), undefined);
});

test("nothing is sent when the extension adds no row", () => {
  const judges = [
    {
      run_judge_id: "a",
      label: "the principal judge",
      rubric: [{ value: 0, meaning: "no" }],
      targets: [{ expected: 0 }],
    },
  ];
  // Left over from rows the form once held and no longer does. Sending it would
  // be refused: `new_targets` on an extension that adds nothing has no meaning.
  assert.equal(alignNewTargets(judges, 0, { a: [{ expected: 0 }] }), undefined);
});

test("the opening grade skips the excluded level", () => {
  // -1 is "the question did not apply". A fresh row must not silently start
  // there: it would read as a control aiming at "not applicable".
  assert.equal(
    openingGrade([
      { value: -1, meaning: "n/a", excluded: true },
      { value: 0, meaning: "no" },
      { value: 2, meaning: "yes" },
    ]),
    0,
  );
});
