// Le coût réel d'une extension ne se stocke pas, il se déduit : l'écart entre
// son `cost_before_usd` et celui de la suivante, ou le coût actuel du run
// pour la dernière. Ce fichier ne teste que cette déduction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extensionsOf } from "./run-extensions.ts";
import type { EvalRun, RunExtensionLogEntry } from "./types";

/** Une entrée minimale, avec juste ce que `extensionsOf` regarde. Le cast
 *  tient parce que la fonction ne lit rien d'autre sur une entrée. */
const ENTRY = (
  cost_before_usd: number | null,
  extra: Partial<RunExtensionLogEntry> = {},
): RunExtensionLogEntry =>
  ({
    at: "2026-09-05T12:00:00.000Z",
    by: "quelquun@polaris.example",
    via: "ui",
    request: { scenario_indices: [0], new_scenarios: [], targets: [], repetitions: 1 },
    estimate: null,
    cost_before_usd,
    ...extra,
  }) as unknown as RunExtensionLogEntry;

/** Un run réduit aux deux champs que `extensionsOf` lit : `extensions` et
 *  `cost_usd`. Le cast tient pour la même raison que dans `ENTRY`. */
const RUN = (extensions: RunExtensionLogEntry[], cost_usd: number | null): EvalRun =>
  ({ extensions, cost_usd }) as unknown as EvalRun;

test("aucune extension : une liste vide", () => {
  assert.deepEqual(extensionsOf(RUN([], 12)), []);
});

test("une seule, run fini : son coût réel est l'écart avec le coût du run", () => {
  const run = RUN([ENTRY(5)], 8);
  const [extension] = extensionsOf(run);
  assert.equal(extension.cost_before_usd, 5);
  assert.equal(extension.actual_cost_usd, 3);
});

test("plusieurs d'affilée : chacune se mesure contre celle qui la suit", () => {
  const run = RUN([ENTRY(0), ENTRY(2), ENTRY(5)], 9);
  const [premiere, seconde, derniere] = extensionsOf(run);
  assert.equal(premiere.actual_cost_usd, 2); // 2 - 0
  assert.equal(seconde.actual_cost_usd, 3); // 5 - 2
  assert.equal(derniere.actual_cost_usd, 4); // 9 - 5
});

test("la dernière quand le run n'a pas encore de coût réel : null, jamais 0", () => {
  const run = RUN([ENTRY(0), ENTRY(2)], null);
  const [premiere, derniere] = extensionsOf(run);
  // La première se mesure contre la suivante, connue : rien ne l'empêche.
  assert.equal(premiere.actual_cost_usd, 2);
  // La dernière se mesurerait contre le coût actuel du run, qui manque.
  assert.equal(derniere.actual_cost_usd, null);
});

test("cost_before_usd manquant sur une entrée : son coût réel est inconnu, pas gratuit", () => {
  // Un run qui n'avait encore rien coûté au moment de cette extension-là — ou
  // dont un modèle employé n'avait pas de tarif — ne doit jamais se lire
  // comme 0 $ : ce sont deux choses différentes, et confondre les deux
  // afficherait un chiffre faux avec la même assurance qu'un chiffre vrai.
  const run = RUN([ENTRY(null), ENTRY(4)], 10);
  const [premiere, derniere] = extensionsOf(run);
  assert.equal(premiere.actual_cost_usd, null);
  assert.equal(derniere.actual_cost_usd, 6);
});

test("chaque entrée garde ce qu'elle portait déjà, en plus du coût réel", () => {
  const entry = ENTRY(1, { by: "agent@polaris.example", via: "mcp" });
  const [extension] = extensionsOf(RUN([entry], 3));
  assert.equal(extension.by, "agent@polaris.example");
  assert.equal(extension.via, "mcp");
  assert.deepEqual(extension.request, entry.request);
});
