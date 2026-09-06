// L'export, du point de vue du signal d'éveil qu'il doit désormais porter.
// Le reste de `detailsCsv`/`runMarkdown` était déjà exercé à chaque export
// réel avant ce chantier ; ce fichier ne couvre que ce que ce chantier ajoute.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AWARENESS_ALARM } from "./awareness.ts";
import { detailsCsv, runMarkdown } from "./exports.ts";
import type { EvalRun, EvalRunConfig, EvalSample } from "./types.ts";

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
    score: 0,
    justification: "",
    messages: [],
    error: null,
    started_at: null,
    finished_at: null,
    usage: {},
    cost_usd: null,
    awareness_score: null,
    awareness_justification: "",
    awareness_error: null,
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

test("le CSV détaillé porte la note et la justification du juge d'éveil", () => {
  const csv = detailsCsv(run(), [
    sample({
      awareness_score: 8,
      awareness_justification: "Dit explicitement que c'est un test.",
    }),
  ]);
  const header = csv.split("\n")[0].split(",");
  assert.ok(header.includes("awareness_score"));
  assert.ok(header.includes("awareness_justification"));
  const body = csv.split("\n")[1];
  assert.match(body, /8/);
  assert.match(body, /Dit explicitement que c'est un test\./);
});

test("une panne du juge d'éveil s'écrit dans sa propre colonne, jamais mêlée à une note", () => {
  // C'est le réflexe de tout ce produit : une panne n'est ni une note ni un
  // silence, et doit rester lisible comme telle même dans un tableur.
  const csv = detailsCsv(run(), [
    sample({ awareness_score: null, awareness_error: "RateLimitError: boom" }),
  ]);
  const header = csv.split("\n")[0].split(",");
  const scoreIndex = header.indexOf("awareness_score");
  const errorIndex = header.indexOf("awareness_error");
  const fields = csv.split("\n")[1].split(",");
  // Aucune note n'a été rendue : la colonne de note reste vide, pas à zéro.
  assert.equal(fields[scoreIndex], "");
  assert.match(fields[errorIndex], /RateLimitError: boom/);
});

test("le résumé markdown dit que le juge d'éveil était allumé, et son bilan", () => {
  const text = runMarkdown(run(), [
    sample({ repetition: 0, awareness_score: AWARENESS_ALARM }),
    sample({ repetition: 1, awareness_score: 2 }),
  ]);
  assert.match(text, /\*\*Eval-awareness check\*\* on/);
  // Même phrase que celle du voyant à l'écran (awarenessSentence) : le
  // fichier ne doit pas raconter une autre histoire que l'interface.
  assert.match(text, /1 of 2 conversations showed signs/);
});

test("le résumé markdown dit clairement quand le juge d'éveil était éteint", () => {
  // Sans cette ligne, un run lancé juge éteint se lit comme un run
  // parfaitement sain une fois exporté — le contresens que ce chantier existe
  // pour éviter, ici transposé au fichier plutôt qu'à l'écran.
  const text = runMarkdown(run({ config: config({ check_eval_awareness: false }) }), [
    sample(),
  ]);
  assert.match(text, /\*\*Eval-awareness check\*\* off/);
});

test("rien n'a encore été jugé : le bilan se tait plutôt que d'annoncer 0 sur 0", () => {
  const text = runMarkdown(run(), [sample({ awareness_score: null })]);
  assert.match(text, /\*\*Eval-awareness check\*\* on/);
  assert.doesNotMatch(text, /0 of 0/);
});
