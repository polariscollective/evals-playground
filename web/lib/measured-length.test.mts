// Ce qu'un run terminé sait dire de la longueur de ses réponses.
//
// Le point à protéger est le dénominateur : c'est la profondeur, pas le nombre
// d'appels réellement facturés. L'estimateur ne compte qu'un appel du modèle
// évalué par tour de conversation ; diviser par autre chose lui ferait rendre
// un total différent de celui qu'on a observé.
//
// Et c'est la profondeur *de la case*, `turns_done`, pas celle que le run
// affiche : une extension relève `turns` pour tout le monde et n'approfondit
// que les cases choisies.
import { test } from "node:test";
import assert from "node:assert/strict";
import { measureRun, answerLengthsFor } from "./measured-length.ts";
import { SHARED_PRICING } from "./shared.ts";
import type { EvalModels, ModelUsage } from "./types.ts";

const MODELS: EvalModels = {
  targets: ["anthropic/claude-sonnet-5", "grok/grok-4.3"],
  adversary: "anthropic/claude-haiku-4-5",
  judge: "openai/gpt-5.6-luna",
};

const usage = (counts: Record<string, number>): Record<string, ModelUsage> =>
  Object.fromEntries(
    Object.entries(counts).map(([model, output]) => [
      model,
      {
        input_tokens: 0,
        output_tokens: output,
        input_tokens_cache_read: 0,
        input_tokens_cache_write: 0,
        reasoning_tokens: 0,
      },
    ]),
  );

/** Une case jouée. `turns_done` à `null` par défaut : c'est la ligne écrite
 *  avant que la colonne n'existe, celle qui doit retomber sur la profondeur du
 *  run. Les cases qui ont une profondeur à elles la nomment. */
const cell = (
  scenario_index: number,
  target_model: string,
  output: number,
  extra: Record<string, number> = {},
  turns_done: number | null = null,
) => ({
  scenario_index,
  target_model,
  status: "done" as const,
  turns_done,
  usage: usage({ [target_model]: output, ...extra }),
});

test("une case propre rend ses jetons de sortie divisés par les tours", () => {
  const mesure = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000)],
    MODELS,
    3,
  );
  assert.equal(mesure.byScenario.get(0), 1000);
});

test("deux cases du même scénario se mettent en commun", () => {
  // 3000 + 1000 jetons pour 2 cases × 2 tours = 1000 par tour.
  const mesure = measureRun(
    [
      cell(0, "anthropic/claude-sonnet-5", 3000),
      cell(0, "grok/grok-4.3", 1000),
    ],
    MODELS,
    2,
  );
  assert.equal(mesure.byScenario.get(0), 1000);
});

test("la moyenne du run est mise en commun, pas moyenne de moyennes", () => {
  // Le scénario 0 est joué deux fois à 100, le scénario 1 une fois à 4000.
  // Mise en commun : (100 + 100 + 4000) / 3 cases = 1400 par tour.
  // Moyenne de moyennes, elle, donnerait (100 + 4000) / 2 = 2050.
  const mesure = measureRun(
    [
      cell(0, "anthropic/claude-sonnet-5", 100),
      cell(0, "grok/grok-4.3", 100),
      cell(1, "anthropic/claude-sonnet-5", 4000),
    ],
    MODELS,
    1,
  );
  assert.equal(mesure.run, 1400);
});

test("une case dont le modèle évalué est aussi le juge est écartée", () => {
  const models: EvalModels = { ...MODELS, judge: "anthropic/claude-sonnet-5" };
  const mesure = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000), cell(0, "grok/grok-4.3", 300)],
    models,
    1,
  );
  assert.equal(mesure.byScenario.get(0), 300);
  assert.equal(mesure.skipped, 1);
});

test("une case dont le modèle évalué est aussi l'adversaire est écartée", () => {
  const models: EvalModels = {
    ...MODELS,
    adversary: "anthropic/claude-sonnet-5",
  };
  const mesure = measureRun(
    [cell(0, "anthropic/claude-sonnet-5", 3000), cell(0, "grok/grok-4.3", 300)],
    models,
    1,
  );
  assert.equal(mesure.byScenario.get(0), 300);
  assert.equal(mesure.skipped, 1);
});

test("un adversaire mesurable rend une longueur non nulle (témoin positif)", () => {
  // Aucun rôle ne se recoupe ici : sert de témoin aux deux tests suivants, qui
  // rendent `null` faute d'un adversaire distinct des autres rôles — sans lui,
  // un `measureRun` qui rendrait toujours `null` passerait quand même.
  const cells = [
    cell(0, "grok/grok-4.3", 500, { "anthropic/claude-haiku-4-5": 1200 }),
  ];
  assert.equal(measureRun(cells, MODELS, 3).adversary, 600);
});

test("un adversaire qui est aussi une cible n'est pas mesurable", () => {
  const models: EvalModels = { ...MODELS, adversary: "grok/grok-4.3" };
  const cells = [cell(0, "grok/grok-4.3", 1200)];
  assert.equal(measureRun(cells, models, 3).adversary, null);
});

test("un adversaire qui est aussi le juge n'est pas mesurable", () => {
  const models: EvalModels = { ...MODELS, judge: "anthropic/claude-haiku-4-5" };
  const cells = [
    cell(0, "grok/grok-4.3", 500, { "anthropic/claude-haiku-4-5": 1200 }),
  ];
  assert.equal(measureRun(cells, models, 3).adversary, null);
});

test("les cases non terminées ne comptent pas", () => {
  const cells = [
    { ...cell(0, "grok/grok-4.3", 500), status: "error" as const },
    { ...cell(0, "grok/grok-4.3", 500), status: "pending" as const },
    { ...cell(0, "grok/grok-4.3", 500), status: "cancelled" as const },
  ];
  const mesure = measureRun(cells, MODELS, 1);
  assert.equal(mesure.byScenario.size, 0);
  assert.equal(mesure.run, null);
  // Écartées parce qu'inachevées, pas parce qu'un modèle cumulait les rôles.
  assert.equal(mesure.skipped, 0);
});

test("une case sans usage enregistré ne compte pas", () => {
  const mesure = measureRun(
    [
      {
        scenario_index: 0,
        target_model: "grok/grok-4.3",
        status: "done" as const,
        turns_done: 1,
        usage: {},
      },
    ],
    MODELS,
    1,
  );
  assert.equal(mesure.run, null);
  // Muette, pas écartée : elle ne doit alourdir ni le compteur de cumul de
  // rôles, ni celui des cases qui ont porté la mesure.
  assert.equal(mesure.kept, 0);
  assert.equal(mesure.skipped, 0);
});

test("l'adversaire se mesure sur turns − 1 appels par case", () => {
  // 900 jetons d'adversaire, 1 case, 4 tours → 3 appels → 300 par appel.
  const cells = [
    cell(0, "grok/grok-4.3", 1200, { "anthropic/claude-haiku-4-5": 900 }),
  ];
  assert.equal(measureRun(cells, MODELS, 4).adversary, 300);
});

test("chaque case est divisée par sa propre profondeur, pas par celle du run", () => {
  // Le run a joué dix cases à 3 tours, 1000 jetons par tour. Une extension a
  // porté `turns` à 6 et approfondi deux d'entre elles, qui ont donc dépensé
  // 6000 jetons. Diviser tout le monde par 6 rendrait 600 — 40 % sous la
  // vérité, et en silence.
  const cells = [
    ...Array.from({ length: 8 }, () =>
      cell(0, "grok/grok-4.3", 3000, {}, 3),
    ),
    ...Array.from({ length: 2 }, () =>
      cell(0, "grok/grok-4.3", 6000, {}, 6),
    ),
  ];
  assert.equal(measureRun(cells, MODELS, 6).run, 1000);
});

test("une case sans profondeur enregistrée retombe sur celle du run", () => {
  // La colonne est plus récente que les premières cases : sans elle, la
  // profondeur du run est la meilleure information disponible — même repli que
  // `groupByModelAndDepth`.
  const cells = [cell(0, "grok/grok-4.3", 3000, {}, null)];
  assert.equal(measureRun(cells, MODELS, 3).run, 1000);
});

test("l'adversaire aussi se compte sur la profondeur de sa case", () => {
  // Une case restée à 3 tours a fait parler l'adversaire 2 fois, celle poussée
  // à 6 l'a fait parler 5 fois : 600 + 1500 jetons pour 7 relances → 300.
  const cells = [
    cell(0, "grok/grok-4.3", 3000, { "anthropic/claude-haiku-4-5": 600 }, 3),
    cell(0, "grok/grok-4.3", 6000, { "anthropic/claude-haiku-4-5": 1500 }, 6),
  ];
  assert.equal(measureRun(cells, MODELS, 6).adversary, 300);
});

test("une case réglée au premier tour ne fait pas parler l'adversaire", () => {
  // Zéro relance : la compter diviserait par zéro. Elle est muette sur
  // l'adversaire, pas nulle.
  const cells = [
    cell(0, "grok/grok-4.3", 1000, { "anthropic/claude-haiku-4-5": 400 }, 1),
    cell(0, "grok/grok-4.3", 3000, { "anthropic/claude-haiku-4-5": 600 }, 3),
  ];
  assert.equal(measureRun(cells, MODELS, 3).adversary, 300);
});

test("à un seul tour, l'adversaire n'est pas mesurable", () => {
  const cells = [cell(0, "grok/grok-4.3", 1200)];
  assert.equal(measureRun(cells, MODELS, 1).adversary, null);
});

test("un scénario mesuré prend sa mesure, un scénario neuf celle du run", () => {
  const mesure = measureRun(
    [
      cell(0, "grok/grok-4.3", 100),
      cell(1, "grok/grok-4.3", 4000),
    ],
    MODELS,
    1,
  );
  // Scénario 0 mesuré, scénario 7 jamais joué → la moyenne du run, 2050.
  assert.deepEqual(answerLengthsFor([0, 7], mesure, 800), [100, 2050]);
});

test("sans aucune case propre, on retombe sur la longueur déclarée", () => {
  const vide = measureRun([], MODELS, 3);
  assert.deepEqual(answerLengthsFor([0, 1], vide, 800), [800, 800]);
});

test("sans déclaration non plus, on retombe sur la moyenne générale", () => {
  const vide = measureRun([], MODELS, 3);
  assert.deepEqual(answerLengthsFor([0], vide, undefined), [
    SHARED_PRICING.default_response_tokens,
  ]);
});

test("le compte des cases retenues est rendu avec la mesure", () => {
  const mesure = measureRun(
    [cell(0, "grok/grok-4.3", 100), cell(1, "grok/grok-4.3", 200)],
    MODELS,
    1,
  );
  assert.equal(mesure.kept, 2);
  assert.equal(mesure.skipped, 0);
});

test("une mesure sur des cases à outils reproduit le total observé", () => {
  // 6000 jetons sur 3 tours, quel que soit le nombre d'appels d'outils qu'il a
  // fallu pour les produire : l'estimateur multipliera 2000 par 3 tours et
  // retombera sur 6000.
  const mesure = measureRun([cell(0, "grok/grok-4.3", 6000)], MODELS, 3);
  assert.equal(mesure.byScenario.get(0)! * 3, 6000);
});

test("un total de zéro jeton n'est pas une mesure", () => {
  // La sortie a été bloquée de bout en bout : le run n'a pas appris que les
  // réponses sont gratuites, il n'a rien appris. Retenir zéro chiffrerait
  // l'extension à un jeton par tour, `clamp` remontant le zéro à un.
  const mesure = measureRun([cell(0, "grok/grok-4.3", 0, {}, 3)], MODELS, 3);
  assert.equal(mesure.run, null);
  assert.equal(mesure.byScenario.get(0), undefined);
  assert.deepEqual(answerLengthsFor([0], mesure, 800), [800]);
});

test("un adversaire entièrement muet n'est pas mesuré à zéro non plus", () => {
  const cells = [
    cell(0, "grok/grok-4.3", 3000, { "anthropic/claude-haiku-4-5": 0 }, 3),
  ];
  assert.equal(measureRun(cells, MODELS, 3).adversary, null);
});

test("une seule case à zéro ne fait pas taire les autres", () => {
  // Le zéro entre bien dans le bassin : c'est le bassin entièrement nul qui ne
  // dit rien, pas la case isolée qui tire la moyenne vers le bas.
  const cells = [
    cell(0, "grok/grok-4.3", 0, {}, 3),
    cell(0, "grok/grok-4.3", 6000, {}, 3),
  ];
  assert.equal(measureRun(cells, MODELS, 3).run, 1000);
});
