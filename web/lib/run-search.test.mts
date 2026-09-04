// Ce que `searchRuns` doit garantir : le filtrage — requête, statut, limite —
// sur ce que `loadRuns` a déjà ramené, sans jamais laisser la requête d'un
// agent atteindre un constructeur `RegExp`, et un extrait qui montre le
// contexte réel autour de la première occurrence trouvée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countMatches, searchRuns } from "./run-search.ts";
import type { RunSummary } from "./types";

/** Un `RunSummary` minimal, avec seulement ce que `searchRuns` regarde. Le
 *  cast tient parce que `searchRuns` ne lit rien d'autre — même pattern que
 *  `public-run.test.mts`. */
function runSummary(fields: {
  id: string;
  created_at: string;
  label?: string | null;
  notes?: string;
  analysis?: string;
  criterion?: string;
  status?: string;
  mean?: number | null;
  cost_usd?: number | null;
  total_samples?: number;
  targets?: string[];
  scenarios?: unknown[];
}): RunSummary {
  return {
    run: {
      id: fields.id,
      created_at: fields.created_at,
      finished_at: null,
      label: fields.label ?? null,
      status: fields.status ?? "done",
      notes: fields.notes ?? "",
      analysis: fields.analysis ?? "",
      total_samples: fields.total_samples ?? 12,
      cost_usd: fields.cost_usd ?? 0.5,
      config: {
        criterion: fields.criterion ?? "",
        scenarios: fields.scenarios ?? [{ title: "un" }, { title: "deux" }],
        models: { targets: fields.targets ?? ["anthropic/claude-sonnet-5"] },
      },
    },
    mean: fields.mean ?? null,
  } as unknown as RunSummary;
}

test("sans requête, les `limit` runs les plus récents, dans l'ordre d'entrée", () => {
  const runs = Array.from({ length: 12 }, (_, i) =>
    runSummary({ id: `r${i}`, created_at: `2026-09-${12 - i}` }),
  );
  const hits = searchRuns(runs, {});
  assert.equal(hits.length, 10);
  assert.deepEqual(
    hits.map((h) => h.id),
    runs.slice(0, 10).map((r) => r.run.id),
  );
});

test("sans requête, `limit` choisit combien", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
    runSummary({ id: "c", created_at: "2026-09-01" }),
  ];
  const hits = searchRuns(runs, { limit: 2 });
  assert.deepEqual(hits.map((h) => h.id), ["a", "b"]);
});

test("la fiche porte toute la forme attendue", () => {
  const runs = [
    runSummary({
      id: "a",
      created_at: "2026-09-03",
      label: "Pression sur la procédure",
      status: "done",
      mean: 0.6,
      cost_usd: 1.23,
      total_samples: 30,
      targets: ["anthropic/claude-sonnet-5", "openai/gpt-5.6-terra"],
      scenarios: [{ title: "un" }, { title: "deux" }, { title: "trois" }],
    }),
  ];
  const [hit] = searchRuns(runs, {});
  assert.deepEqual(hit, {
    id: "a",
    label: "Pression sur la procédure",
    status: "done",
    created_at: "2026-09-03",
    finished_at: null,
    targets: ["anthropic/claude-sonnet-5", "openai/gpt-5.6-terra"],
    scenario_count: 3,
    total_samples: 30,
    mean: 0.6,
    cost_usd: 1.23,
  });
});

test("`limit` est bridé à un minimum de 1", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03" }),
    runSummary({ id: "b", created_at: "2026-09-02" }),
  ];
  assert.equal(searchRuns(runs, { limit: 0 }).length, 1);
  assert.equal(searchRuns(runs, { limit: -5 }).length, 1);
});

test("`limit` est bridé à un maximum de 50", () => {
  const runs = Array.from({ length: 60 }, (_, i) =>
    runSummary({ id: `r${i}`, created_at: `2026-08-${(i % 28) + 1}` }),
  );
  assert.equal(searchRuns(runs, { limit: 1000 }).length, 50);
});

test("la requête matche dans `label`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", label: "Pression sur la procédure" })];
  const hits = searchRuns(runs, { query: "procédure" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["label"]);
});

test("la requête matche dans `notes`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: "Le juge a cédé plus vite que prévu." })];
  const hits = searchRuns(runs, { query: "cédé" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["notes"]);
});

test("la requête matche dans `analysis`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", analysis: "Rien ne distingue les deux modèles." })];
  const hits = searchRuns(runs, { query: "distingue" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["analysis"]);
});

test("la requête matche dans `config.criterion`", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", criterion: "Ce que l'assistant a fait de la demande." })];
  const hits = searchRuns(runs, { query: "demande" });
  assert.deepEqual(hits.map((h) => h.id), ["a"]);
  assert.deepEqual(hits[0].matched_in, ["criterion"]);
});

test("les runs qui ne correspondent pas sont écartés, l'ordre d'entrée est gardé", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-04", notes: "sans rapport" }),
    runSummary({ id: "b", created_at: "2026-09-03", notes: "porte le mot ressort quelque part" }),
    runSummary({ id: "c", created_at: "2026-09-02", label: "ressort aussi" }),
    runSummary({ id: "d", created_at: "2026-09-01", notes: "toujours sans rapport" }),
  ];
  const hits = searchRuns(runs, { query: "ressort" });
  assert.deepEqual(hits.map((h) => h.id), ["b", "c"]);
});

test("le filtrage est insensible à la casse", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: "Le RESSORT a cédé." })];
  assert.deepEqual(searchRuns(runs, { query: "ressort" }).map((h) => h.id), ["a"]);
  assert.deepEqual(searchRuns(runs, { query: "ReSsOrT" }).map((h) => h.id), ["a"]);
});

test("une requête avec des métacaractères d'expression régulière est prise au pied de la lettre", () => {
  const runs = [
    runSummary({ id: "litteral", created_at: "2026-09-03", notes: "un essai qui donne a(b comme résultat" }),
    runSummary({ id: "sans-parenthese", created_at: "2026-09-02", notes: "un essai qui donne ab comme résultat" }),
  ];
  // `new RegExp("a(b")` lèverait — groupe non fermé. Ça ne doit pas arriver.
  assert.doesNotThrow(() => searchRuns(runs, { query: "a(b" }));
  const hits = searchRuns(runs, { query: "a(b" });
  assert.deepEqual(hits.map((h) => h.id), ["litteral"]);
});

test("`.*` ne joue pas les jokers : il ne matche que sa propre sous-chaîne", () => {
  const runs = [
    runSummary({ id: "porte-le-motif", created_at: "2026-09-03", notes: "la note dit .* littéralement" }),
    runSummary({ id: "autre-texte", created_at: "2026-09-02", notes: "un texte quelconque, assez long pour matcher n'importe quel joker" }),
  ];
  const hits = searchRuns(runs, { query: ".*" });
  assert.deepEqual(hits.map((h) => h.id), ["porte-le-motif"]);
});

test("`status` filtre, sans requête", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", status: "done" }),
    runSummary({ id: "b", created_at: "2026-09-02", status: "error" }),
    runSummary({ id: "c", created_at: "2026-09-01", status: "error" }),
  ];
  const hits = searchRuns(runs, { status: "error" });
  assert.deepEqual(hits.map((h) => h.id), ["b", "c"]);
});

test("`status` filtre aussi avec une requête, en égalité stricte", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", status: "done", notes: "porte le mot cible" }),
    runSummary({ id: "b", created_at: "2026-09-02", status: "error", notes: "porte le mot cible" }),
  ];
  const hits = searchRuns(runs, { query: "cible", status: "error" });
  assert.deepEqual(hits.map((h) => h.id), ["b"]);
});

test("aucune correspondance rend une liste vide, pas une erreur", () => {
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: "rien de particulier" })];
  assert.deepEqual(searchRuns(runs, { query: "introuvable" }), []);
});

test("l'extrait montre le contexte autour de la première occurrence, coupé aux deux bouts", () => {
  const text = "x".repeat(200) + "AIGUILLE" + "y".repeat(200);
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: text })];
  const [hit] = searchRuns(runs, { query: "AIGUILLE" });
  const attendu = `…${"x".repeat(80)}AIGUILLE${"y".repeat(120)}…`;
  assert.equal(hit.snippet, attendu);
  assert.ok(hit.snippet!.startsWith("…"));
  assert.ok(hit.snippet!.endsWith("…"));
  assert.ok(hit.snippet!.length <= 250);
});

test("l'extrait n'est pas coupé quand l'occurrence est déjà proche des bords", () => {
  const text = "Le juge a cédé plus vite que prévu.";
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: text })];
  const [hit] = searchRuns(runs, { query: "cédé" });
  assert.equal(hit.snippet, text);
});

test("les suites d'espaces et de retours à la ligne sont réduites à un seul espace", () => {
  const text = "avant\n\n   la  cible   \t après";
  const runs = [runSummary({ id: "a", created_at: "2026-09-03", notes: text })];
  const [hit] = searchRuns(runs, { query: "cible" });
  assert.equal(hit.snippet, "avant la cible après");
});

test("`matched_in` liste tous les champs qui correspondent, pas seulement celui de l'extrait", () => {
  const runs = [
    runSummary({
      id: "a",
      created_at: "2026-09-03",
      label: "audit trimestriel",
      notes: "un audit qui a mal tourné",
      analysis: "sans rapport",
      criterion: "sans rapport non plus",
    }),
  ];
  const [hit] = searchRuns(runs, { query: "audit" });
  assert.deepEqual(hit.matched_in, ["label", "notes"]);
});

test("`countMatches` compte tous les runs qui correspondent, pas seulement ceux que `limit` laisse passer", () => {
  const runs = Array.from({ length: 60 }, (_, i) =>
    runSummary({ id: `r${i}`, created_at: `2026-08-${(i % 28) + 1}`, notes: "porte la cible" }),
  );
  assert.equal(countMatches(runs, { query: "cible" }), 60);
  assert.equal(searchRuns(runs, { query: "cible", limit: 1000 }).length, 50);
});

test("`countMatches` respecte `status` et vaut zéro sans correspondance", () => {
  const runs = [
    runSummary({ id: "a", created_at: "2026-09-03", status: "done", notes: "porte la cible" }),
    runSummary({ id: "b", created_at: "2026-09-02", status: "error", notes: "porte la cible" }),
  ];
  assert.equal(countMatches(runs, { query: "cible" }), 2);
  assert.equal(countMatches(runs, { query: "cible", status: "error" }), 1);
  assert.equal(countMatches(runs, { query: "introuvable" }), 0);
});

test("l'extrait vient du premier champ qui correspond, dans l'ordre label puis criterion puis notes puis analysis", () => {
  const runs = [
    runSummary({
      id: "a",
      created_at: "2026-09-03",
      label: "sans rapport",
      criterion: "le mot cherché est ici, dans le critère",
      notes: "le mot cherché est aussi ici, dans les notes",
    }),
  ];
  const [hit] = searchRuns(runs, { query: "cherché" });
  assert.deepEqual(hit.matched_in, ["criterion", "notes"]);
  assert.ok(hit.snippet!.includes("critère"));
  assert.ok(!hit.snippet!.includes("notes"));
});
