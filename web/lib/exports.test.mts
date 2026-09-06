// L'export, du point de vue de ce que les juges multiples y changent.
//
// Avant ce chantier, une case ne portait qu'une note et une justification —
// des colonnes d'`EvalSample` que la migration
// `20260906093000_drop_eval_samples_score_columns.sql` (dépôt
// polaris-supabase) a supprimées : ce que rend un juge vit désormais dans
// `judge_scores`, une ligne par (juge, conversation). `detailsCsv` et
// `runMarkdown` prennent donc en plus `judges: RunJudgeView[]` — les juges
// vivants du run et leurs verdicts, comme `attachJudges` (`lib/runs.ts`) les
// joint déjà pour l'écran.
//
// Le reste de `detailsCsv`/`runMarkdown` (scénarios, outils, transcript...)
// était déjà exercé à chaque export réel avant ce chantier ; ce fichier ne
// couvre que ce que les juges multiples ajoutent ou changent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AWAKE_TYPE, AWARENESS_ALARM } from "./awareness.ts";
import { detailsCsv, matrixCsv, runMarkdown } from "./exports.ts";
import type {
  EvalRun,
  EvalRunConfig,
  EvalSample,
  Judge,
  JudgeVerdictEntry,
  RunJudgeView,
} from "./types.ts";

function sample(overrides: Partial<EvalSample> = {}): EvalSample {
  return {
    id: "s",
    run_id: "r",
    scenario_index: 0,
    scenario_title: "T",
    target_model: "anthropic/claude-haiku-4-5",
    repetition: 0,
    status: "done",
    temperature: null,
    turns_done: 4,
    messages: [],
    error: null,
    started_at: null,
    finished_at: null,
    usage: {},
    cost_usd: null,
    ...overrides,
  };
}

function config(overrides: Partial<EvalRunConfig> = {}): EvalRunConfig {
  return {
    scenarios: [{ title: "S", system_prompt: "", opening_message: "" }],
    criterion: "Le modèle a tenu la ligne.",
    rubric: [
      { value: 0, meaning: "Non." },
      { value: 1, meaning: "Oui." },
    ],
    turns: 1,
    repetitions: 1,
    models: {
      targets: ["anthropic/claude-haiku-4-5"],
      judge: "anthropic/claude-haiku-4-5",
    },
    adversary_prompt: "",
    ...overrides,
  };
}

// Un cast, comme ailleurs dans ce dépôt (voir run-extensions.test.mts) : ni
// `detailsCsv` ni `runMarkdown` ne regardent les champs qu'on omet ici.
function run(overrides: Partial<EvalRun> = {}): EvalRun {
  return {
    id: "r",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    started_at: null,
    finished_at: null,
    user_email: "quelquun@polaris.example",
    label: "Run de test",
    status: "done",
    error: null,
    config: config(),
    notes: "",
    analysis: "",
    is_public: false,
    deleted_at: null,
    total_samples: 1,
    usage: {},
    cost_usd: null,
    rejudged_at: null,
    awareness_judged_at: null,
    execution: null,
    origin: "local",
    estimate: null,
    extensions: [],
    draft_id: null,
    launched_via: "ui",
    ...overrides,
  } as EvalRun;
}

function judge(overrides: Partial<Judge> = {}): Judge {
  return {
    id: "j",
    criterion: "Le modèle a tenu la ligne.",
    rubric: [
      { value: 0, meaning: "Non." },
      { value: 1, meaning: "Oui." },
    ],
    model: "anthropic/claude-haiku-4-5",
    system_type: "ordinary",
    created_by: "quelquun@polaris.example",
    created_at: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

function verdict(overrides: Partial<JudgeVerdictEntry> = {}): JudgeVerdictEntry {
  return { status: "done", score: 1, justification: "", error: null, ...overrides };
}

/** Une liaison vivante, telle qu'`attachJudges` (`lib/runs.ts`) la rend :
 *  l'identité du juge, son rôle sur ce run, et son verdict par case. */
function runJudge(
  judgeOverrides: Partial<Judge>,
  extra: { isPrincipal?: boolean; scores?: Record<string, JudgeVerdictEntry> } = {},
): RunJudgeView {
  const j = judge(judgeOverrides);
  return {
    run_judge_id: j.id,
    judge: j,
    is_principal: extra.isPrincipal ?? false,
    system_type: j.system_type,
    scores: extra.scores ?? {},
  };
}

test("le CSV détaillé porte une ligne par case et par juge non supprimé", () => {
  const principal = runJudge(
    { id: "p", criterion: "A-t-il refusé ?", model: "anthropic/claude-haiku-4-5" },
    { isPrincipal: true, scores: { s: verdict({ score: 1, justification: "A refusé." }) } },
  );
  const secondaire = runJudge(
    { id: "sec", criterion: "A-t-il expliqué pourquoi ?", model: "openai/gpt-5.6-terra" },
    { isPrincipal: false, scores: { s: verdict({ score: 0, justification: "Pas expliqué." }) } },
  );

  const csv = detailsCsv(run(), [sample()], [principal, secondaire]);
  const lines = csv.split("\n");
  const header = lines[0].split(",");

  // Une ligne d'en-tête, deux lignes de données — une par juge, jamais une
  // colonne de plus : le nombre de juges varie d'un run à l'autre.
  assert.equal(lines.length, 3);

  const idx = (name: string) => header.indexOf(name);
  assert.ok(idx("judge_model") >= 0);
  assert.ok(idx("judge_is_principal") >= 0);

  const principalRow = lines[1].split(",");
  const secondaryRow = lines[2].split(",");
  assert.equal(principalRow[idx("judge_is_principal")], "true");
  assert.equal(principalRow[idx("judge_model")], "anthropic/claude-haiku-4-5");
  assert.equal(principalRow[idx("judge_criterion")], "A-t-il refusé ?");
  assert.equal(principalRow[idx("score")], "1");
  assert.equal(secondaryRow[idx("judge_is_principal")], "false");
  assert.equal(secondaryRow[idx("judge_model")], "openai/gpt-5.6-terra");
  assert.equal(secondaryRow[idx("judge_criterion")], "A-t-il expliqué pourquoi ?");
  assert.equal(secondaryRow[idx("score")], "0");
});

test("le CSV détaillé distingue noté, sans note, en attente et juge tombé", () => {
  // C'est le réflexe de tout ce produit : ces quatre issues ne se mêlent
  // jamais, et doivent rester lisibles comme telles même dans un tableur.
  const noté = runJudge({ id: "a" }, { scores: { s: verdict({ score: 1 }) } });
  const sansNote = runJudge({ id: "b" }, { scores: { s: verdict({ score: null }) } });
  const enAttente = runJudge({ id: "c" }, { scores: {} }); // pas de ligne pour "s"
  const tombé = runJudge(
    { id: "d" },
    { scores: { s: verdict({ status: "error", score: null, error: "RateLimitError: boom" }) } },
  );

  const csv = detailsCsv(run(), [sample()], [noté, sansNote, enAttente, tombé]);
  const [headerLine, ...rows] = csv.split("\n");
  const header = headerLine.split(",");
  const idx = (name: string) => header.indexOf(name);

  // Une ligne par juge, dans l'ordre où `judges` les donne.
  const [row1, row2, row3, row4] = rows.map((line) => line.split(","));

  assert.equal(row1[idx("judge_status")], "done");
  assert.equal(row1[idx("score")], "1");
  assert.equal(row1[idx("judge_error")], "");

  assert.equal(row2[idx("judge_status")], "done");
  assert.equal(row2[idx("score")], "", "sans note : la colonne reste vide, jamais à zéro");
  assert.equal(row2[idx("judge_error")], "");

  assert.equal(row3[idx("judge_status")], "pending");
  assert.equal(row3[idx("score")], "");

  assert.equal(row4[idx("judge_status")], "error");
  assert.equal(row4[idx("score")], "", "un juge tombé ne rend jamais de note");
  assert.match(row4[idx("judge_error")], /RateLimitError: boom/);
});

test("le juge d'éveil porte sa question fixe dans le CSV, jamais un critère vide", () => {
  const awake = runJudge(
    { id: "awake", system_type: AWAKE_TYPE, criterion: null, rubric: null },
    { scores: { s: verdict({ score: AWARENESS_ALARM }) } },
  );
  const csv = detailsCsv(run(), [sample()], [awake]);
  const [headerLine, dataLine] = csv.split("\n");
  const header = headerLine.split(",");
  const row = dataLine.split(",");
  assert.equal(row[header.indexOf("judge_system_type")], "awake");
  assert.match(row[header.indexOf("judge_criterion")], /eval-awareness|test/i);
  assert.notEqual(row[header.indexOf("judge_criterion")], "");
});

test("un juge délié depuis n'apparaît nulle part dans le CSV détaillé", () => {
  // `judges` arrive déjà filtré par l'appelant (`loadLiveRunJudges`) : ce
  // fichier ne fait qu'énumérer ce qu'on lui donne, jamais son propre filtre
  // sur `deleted_at`. Un juge délié n'est simplement plus dans la liste que
  // l'appelant construit — ce test le simule en fabriquant le juge délié
  // sans jamais le transmettre à `detailsCsv`.
  const vivant = runJudge({ id: "vivant", criterion: "Toujours là." }, { isPrincipal: true });
  const délié = runJudge({
    id: "délié",
    criterion: "Un critère qui ne devrait plus jamais apparaître.",
  });
  void délié; // jamais transmis à `detailsCsv` : c'est tout le test.
  const csv = detailsCsv(run(), [sample()], [vivant]);
  assert.ok(!csv.includes("Un critère qui ne devrait plus jamais apparaître."));
  assert.equal(csv.split("\n").length, 2);
});

test("sans aucun juge vivant, la case garde sa ligne, avec des colonnes de juge vides", () => {
  const csv = detailsCsv(run(), [sample()], []);
  const [headerLine, dataLine] = csv.split("\n");
  const header = headerLine.split(",");
  const row = dataLine.split(",");
  assert.equal(row[header.indexOf("judge_status")], "");
  assert.equal(row[header.indexOf("score")], "");
  // La case elle-même n'a pas disparu : ses propres colonnes tiennent toujours.
  assert.equal(row[header.indexOf("target_model")], "anthropic/claude-haiku-4-5");
});

test("le CSV de la matrice suit le juge principal, jamais un secondaire", () => {
  const principal = runJudge({ id: "p" }, { isPrincipal: true, scores: { s: verdict({ score: 1 }) } });
  const secondaire = runJudge({ id: "sec" }, { isPrincipal: false, scores: { s: verdict({ score: 0 }) } });
  const csv = matrixCsv(run(), [sample()], [principal, secondaire]);
  const body = csv.split("\n")[1].split(",");
  assert.equal(body[1], "1.00");
});

test("le CSV de la matrice retombe sur l'échelle réellement posée par le principal", () => {
  // `judge.rubric` prime sur `run.config.rubric`, qui n'est que la valeur
  // historique figée au lancement — un rejugement avec une autre échelle ne
  // doit pas se lire sur l'ancienne.
  const principal = runJudge(
    { id: "p", rubric: [{ value: 10, meaning: "Non." }, { value: 20, meaning: "Oui." }] },
    { isPrincipal: true, scores: { s: verdict({ score: 20 }) } },
  );
  const csv = matrixCsv(run(), [sample()], [principal]);
  const body = csv.split("\n")[1].split(",");
  assert.equal(body[1], "20.00");
});

test("sans juge vivant, la matrice reste en attente plutôt que vide de sens", () => {
  const csv = matrixCsv(run(), [sample()], []);
  const body = csv.split("\n")[1].split(",");
  assert.equal(body[1], "");
});

test("le résumé markdown dit quels juges secondaires ont tourné", () => {
  const principal = runJudge({ id: "p", criterion: "Question du principal." }, { isPrincipal: true });
  const sec1 = runJudge(
    { id: "s1", criterion: "Première question secondaire.", model: "openai/gpt-5.6-terra" },
    { isPrincipal: false },
  );
  const sec2 = runJudge(
    { id: "s2", criterion: "Seconde question secondaire.", model: "grok/grok-4.3" },
    { isPrincipal: false },
  );
  const text = runMarkdown(run(), [sample()], [principal, sec1, sec2]);
  assert.match(text, /## Other judges \(2\)/);
  assert.match(text, /Première question secondaire\./);
  assert.match(text, /Seconde question secondaire\./);
  assert.match(text, /openai\/gpt-5\.6-terra/);
  assert.match(text, /grok\/grok-4\.3/);
  // Le principal a bien sa propre section plus haut (« The principal
  // judge ») mais n'est jamais recompté parmi les « autres juges » : son
  // critère n'apparaît qu'une seule fois dans tout le résumé.
  const occurrences = text.split("Question du principal.").length - 1;
  assert.equal(occurrences, 1);
});

test("le résumé markdown ne montre pas de section « autres juges » sans secondaire", () => {
  const principal = runJudge({ id: "p" }, { isPrincipal: true });
  const text = runMarkdown(run(), [sample()], [principal]);
  assert.doesNotMatch(text, /## Other judges/);
});

test("sans juges chargés, le résumé retombe sur les champs historiques du run", () => {
  // `judges` vide (route qui n'a pas demandé `withJudges`, ou run sans aucune
  // liaison vivante) : l'ancienne forme reste valide, et décrit toujours le
  // principal via `config.criterion`/`config.rubric`/`config.models.judge`.
  const text = runMarkdown(
    run({ config: config({ criterion: "Critère historique du run." }) }),
    [sample()],
    [],
  );
  assert.match(text, /Critère historique du run\./);
});

test("le résumé markdown dit que le juge d'éveil était allumé, et son bilan", () => {
  const awake = runJudge(
    { id: "awake", system_type: AWAKE_TYPE, criterion: null, rubric: null },
    {
      isPrincipal: false,
      scores: {
        s1: verdict({ score: AWARENESS_ALARM }),
        s2: verdict({ score: 2 }),
      },
    },
  );
  const principal = runJudge({ id: "p" }, { isPrincipal: true });
  const text = runMarkdown(
    run({ config: config({ check_eval_awareness: true }) }),
    [sample({ id: "s1", repetition: 0 }), sample({ id: "s2", repetition: 1 })],
    [principal, awake],
  );
  assert.match(text, /\*\*Eval-awareness check\*\* on/);
  // Même phrase que celle du voyant à l'écran (awarenessSentence) : le
  // fichier ne doit pas raconter une autre histoire que l'interface.
  assert.match(text, /1 of 2 conversations showed signs/);
});

test("le résumé markdown dit clairement quand le juge d'éveil était éteint", () => {
  // Sans cette ligne, un run lancé juge éteint se lit comme un run
  // parfaitement sain une fois exporté — le contresens que ce chantier existe
  // pour éviter, ici transposé au fichier plutôt qu'à l'écran.
  const text = runMarkdown(run({ config: config({ check_eval_awareness: false }) }), [sample()], []);
  assert.match(text, /\*\*Eval-awareness check\*\* off/);
});

test("rien n'a encore été jugé : le bilan se tait plutôt que d'annoncer 0 sur 0", () => {
  const awake = runJudge(
    { id: "awake", system_type: AWAKE_TYPE, criterion: null, rubric: null },
    { scores: { s: verdict({ status: "pending", score: null }) } },
  );
  const text = runMarkdown(run({ config: config({ check_eval_awareness: true }) }), [sample()], [awake]);
  assert.match(text, /\*\*Eval-awareness check\*\* on/);
  assert.doesNotMatch(text, /0 of 0/);
});

test("un run d'avant ce champ ne prétend ni allumé ni éteint", () => {
  // `config()` ne porte pas `check_eval_awareness` par défaut — exactement
  // l'état d'un run enregistré avant cette fonctionnalité. Affirmer « on »
  // ici (l'ancien comportement, avec `!== false`) mentirait : ce contrôle n'a
  // jamais tourné sur ce run.
  const text = runMarkdown(run(), [sample()], []);
  assert.doesNotMatch(text, /\*\*Eval-awareness check\*\* on/);
  assert.doesNotMatch(text, /\*\*Eval-awareness check\*\* off/);
  assert.match(text, /\*\*Eval-awareness check\*\* unknown/);
});
