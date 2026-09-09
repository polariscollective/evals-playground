// Ce que `withLiveJudges` change, et ce qu'elle laisse intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLiveJudges } from "./live-config.ts";
import type { EvalRunConfig, Judge, JudgeSystemTypeColumn } from "./types";

/** A minimal configuration, as written at launch — a single judge,
 *  la forme d'avant les juges multiples. */
const CONFIG: EvalRunConfig = {
  scenarios: [
    { title: "Backdated invoice", system_prompt: "s", opening_message: "m" },
  ],
  criterion: "Ce que le run demandait au lancement.",
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
      { value: 0, meaning: "bas" },
      { value: 1, meaning: "haut" },
    ],
    model: "claude-opus",
    system_type: "ordinary",
    created_by: "quelquun@polaris.example",
    created_at: "2026-09-06T10:00:00Z",
    ...overrides,
  };
}

function liaison(
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
  // Rien dans CONFIG ne porte ce juge — c'est tout le point : il n'a jamais
  // been written into `config.judges`, only linked after the fact (`addJudge`).
  const live = [
    liaison("principal", true),
    liaison("ajoute-apres-coup", false),
  ];
  const derived = withLiveJudges(CONFIG, live);
  assert.equal(derived.judges?.length, 1);
  assert.equal(derived.judges?.[0].criterion, "criterion of ajoute-apres-coup");
});

test("an unlinked judge does not reappear, even if the caller left it in `live`", () => {
  // This function does not filter `deleted_at` itself — that is
  // `loadLiveRunJudges`'s job, before calling here (see the file's header). This
  // test dit juste : ce qu'on ne lui passe pas, elle ne l'invente pas.
  const derived = withLiveJudges(CONFIG, [liaison("principal", true)]);
  assert.deepEqual(derived.judges, []);
});

test("the LIVE principal's criterion, scale and model win over the launch's", () => {
  // The principal has changed since (`designatePrincipal`): what the derived
  // configuration must say is who judges today, not who
  // jugeait au lancement.
  const nouveauPrincipal = judge("repris-le-titre", {
    criterion: "New criterion, set after the transfer.",
    model: "gpt-5",
  });
  const live = [
    { judge: nouveauPrincipal, is_principal: true, system_type: "ordinary" as const },
  ];
  const derived = withLiveJudges(CONFIG, live);
  assert.equal(derived.criterion, "New criterion, set after the transfer.");
  assert.equal(derived.models.judge, "gpt-5");
  assert.notEqual(derived.criterion, CONFIG.criterion);
});

test("sans aucun juge vivant, la configuration du lancement fait foi", () => {
  // A run can lose every judge (unlinking the last is allowed): it stays
  // relaunchable, with what it had at the start — not a configuration with no
  // criterion.
  const derived = withLiveJudges(CONFIG, []);
  assert.equal(derived.criterion, CONFIG.criterion);
  assert.deepEqual(derived.rubric, CONFIG.rubric);
  assert.equal(derived.models.judge, CONFIG.models.judge);
});

test("`check_eval_awareness` follows the live awareness link, never what the launch asked for", () => {
  const avecEveil = withLiveJudges(CONFIG, [
    liaison("principal", true),
    liaison("eveil", false, "awake"),
  ]);
  assert.equal(avecEveil.check_eval_awareness, true);

  // Unlinked since (absent from `live`), while `CONFIG.check_eval_awareness` is
  // still `true`: the derived configuration must not bring it back to life on
  // the next relaunch.
  const sansEveil = withLiveJudges(CONFIG, [liaison("principal", true)]);
  assert.equal(sansEveil.check_eval_awareness, false);
});

test("the awareness judge never appears in `judges`: that is not its shape", () => {
  const derived = withLiveJudges(CONFIG, [
    liaison("principal", true),
    liaison("eveil", false, "awake"),
  ]);
  assert.deepEqual(derived.judges, []);
});

test("the rest of the configuration — scenarios, turns, tools — is never touched", () => {
  const derived = withLiveJudges(CONFIG, [liaison("principal", true)]);
  assert.deepEqual(derived.scenarios, CONFIG.scenarios);
  assert.equal(derived.turns, CONFIG.turns);
  assert.equal(derived.repetitions, CONFIG.repetitions);
  assert.deepEqual(derived.models.targets, CONFIG.models.targets);
});

test("the original configuration is never mutated", () => {
  const avant = JSON.stringify(CONFIG);
  withLiveJudges(CONFIG, [
    liaison("principal", true),
    liaison("secondaire", false),
  ]);
  assert.equal(JSON.stringify(CONFIG), avant);
});
