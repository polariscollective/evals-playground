// Les comptes que le panneau d'extension affiche à côté de chaque palier, et
// celui de la sélection qu'il envoie au devis.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countAllGraded,
  countsByLevel,
  countsForSelection,
} from "./deepen-counts.ts";
import type { EvalSample, RubricLevel } from "./types.ts";

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
    ...overrides,
  };
}

const RUBRIC: RubricLevel[] = [
  { value: 0, meaning: "A tenu." },
  { value: 1, meaning: "A cédé." },
  { value: -1, meaning: "Sans objet.", excluded: true },
];

test("chaque palier compte ses essais, répartis par modèle", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 0, target_model: "a" }),
    sample({ score: 0, target_model: "b" }),
    sample({ score: 1, target_model: "a" }),
  ];
  const counts = countsByLevel(samples, RUBRIC);
  assert.equal(counts[0].total, 3);
  assert.deepEqual(counts[0].byModel, { a: 2, b: 1 });
  assert.equal(counts[1].total, 1);
  assert.deepEqual(counts[1].byModel, { a: 1 });
});

test("un palier que personne ne porte reste à zéro", () => {
  const counts = countsByLevel([sample({ score: 0 })], RUBRIC);
  assert.equal(counts[1].total, 0);
  assert.deepEqual(counts[1].byModel, {});
});

test("un palier hors moyenne compte quand même ses essais", () => {
  const counts = countsByLevel([sample({ score: -1 })], RUBRIC);
  assert.equal(counts[2].total, 1);
});

test("les essais en panne, en attente ou sans note ne comptent nulle part", () => {
  const samples = [
    sample({ status: "error", score: null }),
    sample({ status: "pending", score: null }),
    // Conversation vide ou note hors échelle : `done`, mais sans note.
    sample({ status: "done", score: null }),
  ];
  assert.deepEqual(
    countsByLevel(samples, RUBRIC).map((c) => c.total),
    [0, 0, 0],
  );
  assert.equal(countAllGraded(samples).total, 0);
});

test("« tous les essais notés » couvre tous les paliers, répartis par modèle", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 1, target_model: "b" }),
    sample({ score: -1, target_model: "a" }),
  ];
  const all = countAllGraded(samples);
  assert.equal(all.total, 3);
  assert.deepEqual(all.byModel, { a: 2, b: 1 });
});

test("la sélection null n'approfondit rien", () => {
  const samples = [sample({ score: 0 })];
  assert.deepEqual(countsForSelection(samples, null), { total: 0, byModel: {} });
});

test("la sélection \"all\" retrouve le même compte que countAllGraded", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 1, target_model: "b" }),
  ];
  assert.deepEqual(countsForSelection(samples, "all"), countAllGraded(samples));
});

test("une sélection de notes ne prend que les essais qui les portent", () => {
  const samples = [
    sample({ score: 0, target_model: "a" }),
    sample({ score: 1, target_model: "b" }),
    sample({ score: -1, target_model: "a" }),
  ];
  const selected = countsForSelection(samples, [0, -1]);
  assert.equal(selected.total, 2);
  assert.deepEqual(selected.byModel, { a: 2 });
});
