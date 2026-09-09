// Ce que `withLiveJudges` change, et ce qu'elle laisse intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { withLiveJudges } from "./live-config.ts";
import type { EvalRunConfig, Judge, JudgeSystemTypeColumn } from "./types";

/** Une configuration minimale, telle qu'écrite au lancement — un seul juge,
 *  la forme d'avant les juges multiples. */
const CONFIG: EvalRunConfig = {
  scenarios: [
    { title: "Facture antidatée", system_prompt: "s", opening_message: "m" },
  ],
  criterion: "Ce que le run demandait au lancement.",
  rubric: [
    { value: 0, meaning: "Refuse" },
    { value: 1, meaning: "Obéit" },
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
    criterion: `critère de ${id}`,
    rubric: [
      { value: 0, meaning: "bas" },
      { value: 1, meaning: "haut" },
    ],
    model: "claude-opus",
    system_type: "ordinary",
    sees_system_prompt: true,
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

test("un juge ajouté après le lancement apparaît dans `judges`", () => {
  // Rien dans CONFIG ne porte ce juge — c'est tout le point : il n'a jamais
  // été écrit dans `config.judges`, seulement lié après coup (`addJudge`).
  const live = [
    liaison("principal", true),
    liaison("ajoute-apres-coup", false),
  ];
  const derived = withLiveJudges(CONFIG, live);
  assert.equal(derived.judges?.length, 1);
  assert.equal(derived.judges?.[0].criterion, "critère de ajoute-apres-coup");
});

test("un juge délié ne réapparaît pas, même si l'appelant l'a oublié dans `live`", () => {
  // Cette fonction ne filtre pas `deleted_at` elle-même — c'est le travail de
  // `loadLiveRunJudges`, avant d'appeler ici (voir l'en-tête du fichier). Ce
  // test dit juste : ce qu'on ne lui passe pas, elle ne l'invente pas.
  const derived = withLiveJudges(CONFIG, [liaison("principal", true)]);
  assert.deepEqual(derived.judges, []);
});

test("le critère, l'échelle et le modèle du principal VIVANT priment sur ceux du lancement", () => {
  // Le principal a changé depuis (`designatePrincipal`) : ce que la
  // configuration dérivée doit dire, c'est qui juge aujourd'hui, pas qui
  // jugeait au lancement.
  const nouveauPrincipal = judge("repris-le-titre", {
    criterion: "Nouveau critère, posé après le transfert.",
    model: "gpt-5",
  });
  const live = [
    { judge: nouveauPrincipal, is_principal: true, system_type: "ordinary" as const },
  ];
  const derived = withLiveJudges(CONFIG, live);
  assert.equal(derived.criterion, "Nouveau critère, posé après le transfert.");
  assert.equal(derived.models.judge, "gpt-5");
  assert.notEqual(derived.criterion, CONFIG.criterion);
});

test("sans aucun juge vivant, la configuration du lancement fait foi", () => {
  // Un run peut perdre tous ses juges (le dernier déliable est permis) : il
  // reste relançable, avec ce qu'il avait au départ — pas une configuration
  // sans critère.
  const derived = withLiveJudges(CONFIG, []);
  assert.equal(derived.criterion, CONFIG.criterion);
  assert.deepEqual(derived.rubric, CONFIG.rubric);
  assert.equal(derived.models.judge, CONFIG.models.judge);
});

test("`check_eval_awareness` suit la liaison d'éveil vivante, jamais ce que le lancement avait demandé", () => {
  const avecEveil = withLiveJudges(CONFIG, [
    liaison("principal", true),
    liaison("eveil", false, "awake"),
  ]);
  assert.equal(avecEveil.check_eval_awareness, true);

  // Délié depuis (absent de `live`), alors que `CONFIG.check_eval_awareness`
  // vaut toujours `true` : la configuration dérivée ne doit pas le faire
  // revivre à la prochaine relance.
  const sansEveil = withLiveJudges(CONFIG, [liaison("principal", true)]);
  assert.equal(sansEveil.check_eval_awareness, false);
});

test("le juge d'éveil n'apparaît jamais dans `judges` : ce n'est pas sa forme", () => {
  const derived = withLiveJudges(CONFIG, [
    liaison("principal", true),
    liaison("eveil", false, "awake"),
  ]);
  assert.deepEqual(derived.judges, []);
});

test("le reste de la configuration — scénarios, tours, outils — n'est jamais touché", () => {
  const derived = withLiveJudges(CONFIG, [liaison("principal", true)]);
  assert.deepEqual(derived.scenarios, CONFIG.scenarios);
  assert.equal(derived.turns, CONFIG.turns);
  assert.equal(derived.repetitions, CONFIG.repetitions);
  assert.deepEqual(derived.models.targets, CONFIG.models.targets);
});

test("la configuration d'origine n'est jamais mutée", () => {
  const avant = JSON.stringify(CONFIG);
  withLiveJudges(CONFIG, [
    liaison("principal", true),
    liaison("secondaire", false),
  ]);
  assert.equal(JSON.stringify(CONFIG), avant);
});
