// Ce qu'une ligne de brouillon affiche, et où mène sa fusée.
import { test } from "node:test";
import assert from "node:assert/strict";
import { draftDestination, draftShape } from "./draft-row.ts";
import type { Draft } from "./types.ts";

const base = {
  id: "d1",
  csv_text: null,
  created_by: "moi@example.org",
  created_at: "2026-09-07T10:00:00Z",
  origin: "mcp" as const,
  deleted_at: null,
  launched_at: null,
  launched_run_id: null,
};

const runDraft = (over: object = {}): Draft =>
  ({
    ...base,
    kind: "run",
    extends_run_id: null,
    config: { scenarios: [{}, {}], models: { targets: ["m"] }, repetitions: 3 },
    ...over,
  }) as unknown as Draft;

const extendDraft = (over: object = {}): Draft =>
  ({
    ...base,
    kind: "extend",
    extends_run_id: "r1",
    config: { scenario_indices: [0, 1], new_scenarios: [], targets: ["m"], repetitions: 1 },
    ...over,
  }) as unknown as Draft;

test("la forme d'un brouillon de run se lit scénarios × modèles × répétitions", () => {
  assert.equal(draftShape(runDraft()), "2 × 1 × 3");
});

test("un brouillon incomplet affiche des zéros plutôt que de tomber", () => {
  assert.equal(draftShape(runDraft({ config: {} })), "0 × 0 × 0");
});

test("une extension montre ce qu'elle AJOUTE, marqué d'un plus", () => {
  // Sans le « + », on lirait la taille finale du run, qu'on n'a pas ici.
  assert.equal(draftShape(extendDraft()), "+2 × 1 × 1");
});

test("la fusée d'un brouillon de run mène au formulaire pré-rempli", () => {
  assert.equal(draftDestination(runDraft()), "/?draft=d1");
});

test("celle d'une extension mène à la page de son run, panneau ouvert", () => {
  // Une extension ne se lance pas depuis le formulaire : elle s'ajoute à un
  // run, et c'est sur ce run qu'elle se relit.
  assert.equal(draftDestination(extendDraft()), "/eval/r1?extend=d1");
});

test("un brouillon déjà lancé mène au run qu'il a produit", () => {
  assert.equal(
    draftDestination(runDraft({ launched_at: "2026-09-07", launched_run_id: "r9" })),
    "/eval/r9",
  );
  assert.equal(
    draftDestination(extendDraft({ launched_at: "2026-09-07", launched_run_id: "r9" })),
    "/eval/r9",
  );
});

test("une extension déjà appliquée mène à l'historique du run, pas à son panneau", () => {
  // Réappliquer n'est pas idempotent : les répétitions s'empilent. Une
  // extension lancée est donc une trace, plus une proposition à rouvrir — et
  // `launched_run_id` n'est jamais écrit, si bien que `launched_at` est le
  // seul témoin qu'elle a servi.
  assert.equal(
    draftDestination(extendDraft({ launched_at: "2026-09-06T16:33:42.873Z" })),
    "/eval/r1#extensions",
  );
});

test("une extension en attente mène toujours à son panneau", () => {
  assert.equal(draftDestination(extendDraft()), "/eval/r1?extend=d1");
});
