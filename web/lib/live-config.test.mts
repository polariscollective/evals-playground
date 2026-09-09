// What `withLiveJudges` changes, and what it leaves intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLiveJudges } from "./live-config.ts";
import type { EvalRunConfig, Judge, JudgeSystemTypeColumn } from "./types";

/** A minimal configuration, as written at launch — a single judge, the shape
 *  from before the multiple judges. */
const CONFIG: EvalRunConfig = {
  scenarios: [
    { title: "Backdated invoice", system_prompt: "s", opening_message: "m" },
  ],
  criterion: "What the run asked for at launch.",
  rubric: [
    { value: 0, meaning: "Refuse" },
    { value: 1, meaning: "Complies" },
  ],
  turns: 1,
  repetitions: 1,
  models: { targets: ["gpt-5"], adversary: null, judge: "claude-opus" },
  adversary_prompt: "",
  check_eval_awareness: true,
};

function judge(
  id: string,
  overrides: Partial<Judge> = {},
): Judge {
  return {
    id,
    criterion: `criterion of ${id}`,
    rubric: [
      { value: 0, meaning: "low" },
      { value: 1, meaning: "high" },
    ],
    model: "claude-opus",
    system_type: "ordinary",
    sees_system_prompt: true,
    created_by: "somebody@polaris.example",
    created_at: "2026-09-06T10:00:00Z",
    ...overrides,
  };
}

function link(
  id: string,
  isPrincipal: boolean,
  systemType: JudgeSystemTypeColumn = "ordinary",
  overrides: Partial<Judge> = {},
) {
  return {
    judge: judge(id, { system_type: systemType, ...overrides }),
    is_principal: isPrincipal,
    system_type: systemType,
  };
}

test("a judge added after launch appears in `judges`", () => {
  // Nothing in CONFIG carries this judge — that is the whole point: it was never
  // been written into `config.judges`, only linked after the fact (`addJudge`).
  const live = [
    link("principal", true),
    link("added-afterwards", false),
  ];
  const derived = withLiveJudges(CONFIG, live);
  assert.equal(derived.judges?.length, 1);
  assert.equal(derived.judges?.[0].criterion, "criterion of added-afterwards");
});

test("an unlinked judge does not reappear, even if the caller left it in `live`", () => {
  // This function does not filter `deleted_at` itself — that is
  // `loadLiveRunJudges`'s job, before calling here (see the file's header). This
  // test only says: what it is not passed, it does not invent.
  const derived = withLiveJudges(CONFIG, [link("principal", true)]);
  assert.deepEqual(derived.judges, []);
});

test("the LIVE principal's criterion, scale and model win over the launch's", () => {
  // The principal has changed since (`designatePrincipal`): what the derived
  // configuration must say is who judges today, not who judged at launch.
  const newPrincipal = judge("took-over-the-title", {
    criterion: "New criterion, set after the transfer.",
    model: "gpt-5",
  });
  const live = [
    { judge: newPrincipal, is_principal: true, system_type: "ordinary" as const },
  ];
  const derived = withLiveJudges(CONFIG, live);
  assert.equal(derived.criterion, "New criterion, set after the transfer.");
  assert.equal(derived.models.judge, "gpt-5");
  assert.notEqual(derived.criterion, CONFIG.criterion);
});

test("with no live judge at all, the launch configuration is authoritative", () => {
  // A run can lose every judge (unlinking the last is allowed): it stays
  // relaunchable, with what it had at the start — not a configuration with no
  // criterion.
  const derived = withLiveJudges(CONFIG, []);
  assert.equal(derived.criterion, CONFIG.criterion);
  assert.deepEqual(derived.rubric, CONFIG.rubric);
  assert.equal(derived.models.judge, CONFIG.models.judge);
});

test("`check_eval_awareness` follows the live awareness link, never what the launch asked for", () => {
  const withAwareness = withLiveJudges(CONFIG, [
    link("principal", true),
    link("awareness", false, "awake"),
  ]);
  assert.equal(withAwareness.check_eval_awareness, true);

  // Unlinked since (absent from `live`), while `CONFIG.check_eval_awareness` is
  // still `true`: the derived configuration must not bring it back to life on
  // the next relaunch.
  const withoutAwareness = withLiveJudges(CONFIG, [link("principal", true)]);
  assert.equal(withoutAwareness.check_eval_awareness, false);
});

test("the awareness judge never appears in `judges`: that is not its shape", () => {
  const derived = withLiveJudges(CONFIG, [
    link("principal", true),
    link("awareness", false, "awake"),
  ]);
  assert.deepEqual(derived.judges, []);
});

test("the rest of the configuration — scenarios, turns, tools — is never touched", () => {
  const derived = withLiveJudges(CONFIG, [link("principal", true)]);
  assert.deepEqual(derived.scenarios, CONFIG.scenarios);
  assert.equal(derived.turns, CONFIG.turns);
  assert.equal(derived.repetitions, CONFIG.repetitions);
  assert.deepEqual(derived.models.targets, CONFIG.models.targets);
});

test("the original configuration is never mutated", () => {
  const before = JSON.stringify(CONFIG);
  withLiveJudges(CONFIG, [
    link("principal", true),
    link("secondary", false),
  ]);
  assert.equal(JSON.stringify(CONFIG), before);
});
