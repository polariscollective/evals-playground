// The building of the judge rows to create at launch — the only part of this
// mechanism that writes nothing to Supabase, and so tests for
// de vrai. Voir cells.test.mts, dont ce fichier reprend le geste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgesForLaunch } from "./launch-judges.ts";
import type { EvalRunConfig } from "./types";

function config(overrides: Partial<EvalRunConfig> = {}): EvalRunConfig {
  return {
    scenarios: [],
    criterion: "Did the model give in?",
    rubric: [
      { value: 0, meaning: "Non." },
      { value: 1, meaning: "Oui." },
    ],
    turns: 1,
    repetitions: 1,
    models: { targets: ["a/1"], judge: "juge/1" },
    adversary_prompt: "",
    ...overrides,
  };
}

/** A deterministic identifier generator: "id-0", "id-1", ... — so that the
 *  assertions can aim at a particular row without depending on a real
 *  UUID. */
function counter(): () => string {
  let n = 0;
  return () => `id-${n++}`;
}

// --- le seul juge, l'ancienne forme -----------------------------------------

test("with no secondary judges and no awareness, one judge: the principal", () => {
  const { judges, runJudges, judgeScores } = judgesForLaunch(
    config({ check_eval_awareness: false }),
    "run-1",
    "a@b.c",
    ["s1", "s2"],
    counter(),
  );

  assert.equal(judges.length, 1);
  assert.equal(runJudges.length, 1);
  assert.deepEqual(judges[0], {
    id: "id-0",
    criterion: "Did the model give in?",
    rubric: [
      { value: 0, meaning: "Non." },
      { value: 1, meaning: "Oui." },
    ],
    model: "juge/1",
    // Sentinelle, jamais `null`, depuis la migration du 6 septembre qui a
    // durci la colonne (voir `JudgeSystemTypeColumn`, `types.ts`) : un juge
    // an ordinary one is no longer recognised by an absent type but by that
    // precise value.
    system_type: "ordinary",
    created_by: "a@b.c",
  });
  assert.deepEqual(runJudges[0], {
    id: "id-1",
    run_id: "run-1",
    judge_id: "id-0",
    system_type: "ordinary",
    is_principal: true,
  });
  // Une ligne de score par conversation, pour cet unique juge.
  assert.equal(judgeScores.length, 2);
  for (const score of judgeScores) {
    assert.equal(score.run_judge_id, "id-1");
    assert.equal(score.run_id, "run-1");
  }
  assert.deepEqual(
    judgeScores.map((s) => s.sample_id).sort(),
    ["s1", "s2"],
  );
});

test("the principal is always the first judge, and the only one marked principal", () => {
  const { runJudges } = judgesForLaunch(
    config({
      check_eval_awareness: false,
      judges: [
        {
          criterion: "Was it honest?",
          rubric: [
            { value: 0, meaning: "Non." },
            { value: 1, meaning: "Oui." },
          ],
        },
      ],
    }),
    "run-1",
    "a@b.c",
    ["s1"],
    counter(),
  );

  assert.equal(runJudges.filter((j) => j.is_principal).length, 1);
  assert.equal(runJudges[0].is_principal, true);
});

// --- les juges secondaires ---------------------------------------------------

test("every entry of config.judges becomes a secondary, ordinary judge", () => {
  const { judges, runJudges } = judgesForLaunch(
    config({
      check_eval_awareness: false,
      judges: [
        {
          criterion: "Was it honest?",
          rubric: [
            { value: 0, meaning: "Non." },
            { value: 1, meaning: "Oui." },
          ],
        },
        {
          criterion: "Did it refuse?",
          rubric: [
            { value: 0, meaning: "Non." },
            { value: 1, meaning: "Oui." },
          ],
          model: "juge/2",
        },
      ],
    }),
    "run-1",
    "a@b.c",
    ["s1"],
    counter(),
  );

  assert.equal(judges.length, 3);
  const [, honest, refuse] = judges;
  assert.equal(honest.criterion, "Was it honest?");
  // With no model of its own, the secondary judge takes the run's.
  assert.equal(honest.model, "juge/1");
  assert.equal(refuse.model, "juge/2");
  assert.equal(runJudges.filter((j) => j.is_principal).length, 1);
  assert.deepEqual(
    runJudges.map((j) => j.is_principal),
    [true, false, false],
  );
});

// --- the awareness judge ------------------------------------------------------

test("check_eval_awareness absent adds the awareness judge, of system type", () => {
  const { judges, runJudges } = judgesForLaunch(
    config(),
    "run-1",
    "a@b.c",
    ["s1"],
    counter(),
  );

  assert.equal(judges.length, 2);
  const eveil = judges[1];
  assert.equal(eveil.system_type, "awake");
  assert.equal(eveil.criterion, null);
  assert.equal(eveil.rubric, null);
  assert.equal(eveil.model, "juge/1");
  assert.equal(runJudges[1].system_type, "awake");
  assert.equal(runJudges[1].is_principal, false);
});

test("check_eval_awareness at false adds no awareness judge", () => {
  const { judges } = judgesForLaunch(
    config({ check_eval_awareness: false }),
    "run-1",
    "a@b.c",
    ["s1"],
    counter(),
  );
  // "Is this judge a system one?" is read by a VALUE (`!== "ordinary"`), never
  // by an absence (`!= null`): the column can no longer be null since the
  // sentinel. A null test restored here would silently pass every judge for a
  // system one, since none would ever be `null` again — and this very test
  // would not see it.
  assert.ok(judges.every((j) => j.system_type === "ordinary"));
});

test("an awareness judge is never read from config.judges", () => {
  // config.judges carries only ordinary judges (see JudgeSpec); even
  // si l'appelant y glissait un system_type, cette fonction ne le lit pas —
  // check_eval_awareness alone commands the awareness judge's addition.
  const { judges } = judgesForLaunch(
    config({
      judges: [
        {
          criterion: "Did it give in?",
          rubric: [
            { value: 0, meaning: "Non." },
            { value: 1, meaning: "Oui." },
          ],
        },
      ],
    }),
    "run-1",
    "a@b.c",
    ["s1"],
    counter(),
  );
  // The principal, the secondary, then awareness: three judges, one system.
  // Always a value comparison (`!== "ordinary"`), never a null check —
  // voir le rappel plus haut dans ce fichier.
  assert.equal(judges.length, 3);
  assert.equal(judges.filter((j) => j.system_type !== "ordinary").length, 1);
});

// --- les lignes de score ------------------------------------------------------

test("une ligne de score par juge et par conversation, jamais une de plus", () => {
  const { runJudges, judgeScores } = judgesForLaunch(
    config({
      judges: [
        {
          criterion: "Was it honest?",
          rubric: [
            { value: 0, meaning: "Non." },
            { value: 1, meaning: "Oui." },
          ],
        },
      ],
    }),
    "run-1",
    "a@b.c",
    ["s1", "s2", "s3"],
    counter(),
  );

  // Three judges (principal, secondary, awareness) × three conversations.
  assert.equal(runJudges.length, 3);
  assert.equal(judgeScores.length, 9);
  for (const runJudge of runJudges) {
    const siennes = judgeScores.filter((s) => s.run_judge_id === runJudge.id);
    assert.equal(siennes.length, 3);
    assert.deepEqual(siennes.map((s) => s.sample_id).sort(), ["s1", "s2", "s3"]);
  }
});

test("with no conversation, no score row — the judges exist all the same", () => {
  const { judges, judgeScores } = judgesForLaunch(
    config({ check_eval_awareness: false }),
    "run-1",
    "a@b.c",
    [],
    counter(),
  );
  assert.equal(judges.length, 1);
  assert.equal(judgeScores.length, 0);
});
