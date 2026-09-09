// Étendre une étude sans dire ce qu'on attend des lignes qu'on ajoute produit
// une matrice à deux moitiés : les anciennes lignes ont une cible, les neuves
// non, et six mois plus tard rien ne dit laquelle on peut lire.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extendTargetsProblem, extendedTargets } from "./targets.ts";
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

// Un réglage sans effet est pire qu'absent — la règle que ce dépôt applique
// déjà au modèle de monde d'une extension qui n'ajoute rien de servi.
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

// Le cœur de la règle.
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

// Un juge qui a dit « j'explorais » ne reçoit pas de cibles pour les seules
// lignes neuves : ça lui fabriquerait la liste à trous refusée partout ailleurs.
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

// Chaque juge est vérifié contre SON échelle : c'est ce qui rattrape une cible
// recopiée du principal sur un juge d'honnêteté qui note de 1 à 10.
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
  // Rien n'est muté : la liste d'origine sert encore à comparer avec la base.
  assert.equal(before.length, 2);
});

test("a judge that declared no targets does not gain any by being extended", () => {
  assert.equal(extendedTargets(null, [{ expected: 0 }]), null);
});
