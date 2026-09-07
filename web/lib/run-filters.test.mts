// Le filtre des deux listes : de quel côté tombe une ligne, ce que la barre
// propose, et ce qui reste affiché.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIMENSIONS,
  OPEN,
  PSEUDO_TAG_CLASSES,
  STATUS_TAGS,
  choiceOf,
  cycleDimension,
  draftSides,
  isReservedTag,
  matchesQuery,
  nextChoice,
  offered,
  passes,
  runSides,
  sameFilter,
  sideLabel,
  toggleOff,
} from "./run-filters.ts";
import type { FilterableDraft, FilterableRun } from "./run-filters.ts";

const run = (over: Partial<FilterableRun> = {}): FilterableRun => ({
  status: "done",
  origin: "cloud-run",
  is_public: false,
  launched_via: "ui",
  ...over,
});

const draft = (over: Partial<FilterableDraft> = {}): FilterableDraft => ({
  kind: "run",
  launched_at: null,
  origin: "manual",
  ...over,
});

// --- de quel côté tombe une ligne -------------------------------------------

test("un run ordinaire tombe du côté banal de chaque dimension", () => {
  assert.deepEqual(runSides(run()), {
    machine: "b",
    visibility: "b",
    author: "b",
  });
});

test("chaque propriété notable bascule sa dimension", () => {
  assert.equal(runSides(run({ origin: "local" })).machine, "a");
  assert.equal(runSides(run({ is_public: true })).visibility, "a");
  assert.equal(runSides(run({ launched_via: "mcp" })).author, "a");
});

test("un brouillon n'a ni machine ni publication", () => {
  const sides = draftSides(draft());
  assert.equal(sides.machine, undefined);
  assert.equal(sides.visibility, undefined);
  assert.deepEqual(sides, { author: "b", kind: "b", launch: "b" });
});

test("les trois dimensions d'un brouillon basculent", () => {
  assert.equal(draftSides(draft({ origin: "mcp" })).author, "a");
  assert.equal(draftSides(draft({ kind: "extend" })).kind, "a");
  assert.equal(draftSides(draft({ launched_at: "2026-09-07" })).launch, "a");
});

test("chaque côté a son mot", () => {
  assert.equal(sideLabel("machine", "a"), "local");
  assert.equal(sideLabel("machine", "b"), "live");
  assert.equal(sideLabel("author", "a"), "mcp");
  assert.equal(sideLabel("author", "b"), "manual");
});

// --- le tour d'un bouton ----------------------------------------------------

test("un bouton tourne : les deux, le côté notable, l'autre, les deux", () => {
  // `a` en premier : on clique « MCP » pour VOIR les runs d'agent.
  assert.equal(nextChoice("both"), "a");
  assert.equal(nextChoice("a"), "b");
  assert.equal(nextChoice("b"), "both");
});

test("le tour complet ramène à l'état ouvert, sans rien laisser derrière", () => {
  let state = OPEN;
  state = cycleDimension(state, "author");
  assert.equal(choiceOf(state, "author"), "a");
  state = cycleDimension(state, "author");
  assert.equal(choiceOf(state, "author"), "b");
  state = cycleDimension(state, "author");
  assert.equal(choiceOf(state, "author"), "both");
  // « both » ne s'écrit pas : l'absence le dit, et c'est ce qui fait qu'une
  // dimension ajoutée demain naîtra ouverte.
  assert.deepEqual(state.dims, {});
});

test("réduire une dimension n'en touche aucune autre", () => {
  const state = cycleDimension(cycleDimension(OPEN, "author"), "machine");
  assert.equal(choiceOf(state, "author"), "a");
  assert.equal(choiceOf(state, "machine"), "a");
});

// --- ce qui passe -----------------------------------------------------------

test("rien de réduit, rien d'éteint : tout passe", () => {
  assert.equal(passes(runSides(run()), ["done", "budget"], OPEN), true);
});

test("réduire au côté notable ne garde que lui", () => {
  const state = cycleDimension(OPEN, "author");
  assert.equal(passes(runSides(run({ launched_via: "mcp" })), [], state), true);
  assert.equal(passes(runSides(run({ launched_via: "ui" })), [], state), false);
});

test("réduire à l'autre côté fait exactement l'inverse", () => {
  // C'est ce que l'ancien modèle binaire ne savait pas faire : « je ne veux
  // QUE les runs d'agent » n'avait aucun bouton.
  const state = cycleDimension(cycleDimension(OPEN, "author"), "author");
  assert.equal(passes(runSides(run({ launched_via: "mcp" })), [], state), false);
  assert.equal(passes(runSides(run({ launched_via: "ui" })), [], state), true);
});

test("deux dimensions réduites se cumulent", () => {
  let state = cycleDimension(OPEN, "author");
  state = cycleDimension(state, "machine");
  assert.equal(
    passes(runSides(run({ launched_via: "mcp", origin: "local" })), [], state),
    true,
  );
  assert.equal(
    passes(
      runSides(run({ launched_via: "mcp", origin: "cloud-run" })),
      [],
      state,
    ),
    false,
  );
});

test("une dimension que la ligne ne connaît pas ne l'écarte pas", () => {
  // Un brouillon n'a pas de machine : le filtre des runs ne doit pas l'effacer.
  const state = cycleDimension(OPEN, "machine");
  assert.equal(passes(draftSides(draft()), [], state), true);
});

test("un tag éteint écarte les lignes qui le portent, et elles seules", () => {
  const state = toggleOff(OPEN, "budget");
  assert.equal(passes({}, ["budget", "test"], state), false);
  assert.equal(passes({}, ["test"], state), true);
  // Une ligne sans tag ne porte rien qu'on ait éteint.
  assert.equal(passes({}, [], state), true);
});

test("éteindre puis rallumer ne laisse aucune trace", () => {
  const state = toggleOff(toggleOff(OPEN, "budget"), "budget");
  assert.deepEqual(state.off, []);
});

// --- ce que la barre propose ------------------------------------------------

test("la barre ne propose une dimension que si son côté notable existe", () => {
  const rows = [
    { sides: runSides(run({ origin: "local" })), labels: ["done"] },
    { sides: runSides(run()), labels: ["done", "budget"] },
  ];
  const bar = offered("runs", rows);
  // « machine » : un run est local. « visibility » et « author » : personne
  // n'est publié ni lancé par un agent, donc pas de bouton.
  assert.deepEqual(bar.dims, ["machine"]);
  assert.deepEqual(bar.statuses, ["done"]);
  assert.deepEqual(bar.tags, ["budget"]);
});

test("chaque liste ne voit que les dimensions qui la concernent", () => {
  const drafts = [
    { sides: draftSides(draft({ origin: "mcp", kind: "extend" })), labels: [] },
    { sides: draftSides(draft({ launched_at: "2026-09-07" })), labels: [] },
  ];
  // Ni machine ni publication : elles n'ont pas de sens sur un brouillon.
  assert.deepEqual(offered("drafts", drafts).dims, ["author", "kind", "launch"]);
  // Et inversement : « kind » et « launch » n'ont rien à faire sur les runs.
  const runs = [{ sides: runSides(run({ launched_via: "mcp" })), labels: [] }];
  assert.deepEqual(offered("runs", runs).dims, ["author"]);
});

test("les statuts gardent leur ordre, les tags sont triés et dédupliqués", () => {
  const bar = offered("runs", [
    { sides: {}, labels: ["error", "zèbre"] },
    { sides: {}, labels: ["done", "alpha", "zèbre"] },
  ]);
  assert.deepEqual(bar.statuses, ["done", "error"]);
  assert.deepEqual(bar.tags, ["alpha", "zèbre"]);
});

// --- réserve et couleurs ----------------------------------------------------

test("les deux côtés de chaque dimension sont réservés, et les statuts aussi", () => {
  const reserved = [
    "local", "live", "public", "private", "mcp", "MCP", "manual",
    "extend", "creation", "launched", "waiting", "done", "ERROR", " Running ",
  ];
  for (const label of reserved) {
    assert.equal(isReservedTag(label), true, label);
  }
  for (const label of ["locale", "publication", "mcp-test", "test", "done-ish"]) {
    assert.equal(isReservedTag(label), false, label);
  }
});

test("chaque mot affichable a ses classes", () => {
  // La barre et le badge de la ligne lisent cette même table : c'est ce qui
  // les empêche de diverger.
  const mots = [
    ...STATUS_TAGS,
    ...Object.values(DIMENSIONS).flatMap((d) => [d.a, d.b]),
  ];
  for (const mot of mots) {
    assert.ok(PSEUDO_TAG_CLASSES[mot]?.length > 0, mot);
  }
  assert.equal(Object.keys(PSEUDO_TAG_CLASSES).length, mots.length);
});

// --- « suis-je déjà là ? », qui décide si un lien s'éteint -------------------

test("deux filtres identiques se reconnaissent, quel que soit l'ordre", () => {
  // Comparés champ par champ, pas par sérialisation : l'ordre des clés d'un
  // objet et celui d'un tableau ne sont pas garantis, et deux filtres égaux
  // écrits dans un ordre différent se seraient dits différents — le lien
  // serait resté actif en promettant un geste sans effet.
  const a = { dims: { author: "a" as const }, off: ["x", "y"] };
  const b = { dims: { author: "a" as const }, off: ["y", "x"] };
  assert.equal(sameFilter(a, b), true);
});

test("une dimension réduite, ou un tag de plus, suffit à les distinguer", () => {
  assert.equal(sameFilter(OPEN, { dims: { author: "a" }, off: [] }), false);
  assert.equal(sameFilter(OPEN, { dims: {}, off: ["budget"] }), false);
  assert.equal(sameFilter(OPEN, { dims: {}, off: [] }), true);
});

// --- la recherche ------------------------------------------------------------

test("une recherche vide laisse tout passer", () => {
  assert.equal(matchesQuery(["n'importe quoi"], ""), true);
  assert.equal(matchesQuery([null], "   "), true);
});

test("elle ignore la casse", () => {
  assert.equal(matchesQuery(["Task 17 live check"], "TASK"), true);
  assert.equal(matchesQuery(["Task 17 live check"], "live"), true);
});

test("elle ignore les accents, dans les deux sens", () => {
  // Personne ne devrait avoir à composer un accent pour retrouver son run.
  assert.equal(matchesQuery(["régression"], "regression"), true);
  assert.equal(matchesQuery(["regression"], "régression"), true);
});

test("elle cherche dans l'identifiant, pas seulement dans le nom", () => {
  // C'est ce qu'un agent rend et ce qu'on colle depuis un journal.
  assert.equal(
    matchesQuery(["un titre", "b7d288d8-eef2-4bdb-b432-9a611b1b11d0"], "b7d288d8"),
    true,
  );
});

test("un nom absent ne fait pas tomber la recherche", () => {
  assert.equal(matchesQuery([null, "abc"], "abc"), true);
  assert.equal(matchesQuery([null, "abc"], "zzz"), false);
});
