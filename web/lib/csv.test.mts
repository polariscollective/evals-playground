// Ce qu'un lot reconstruit en mémoire ne doit pas perdre.
//
// Un document de plusieurs scénarios repasse par un CSV pour remplir le
// formulaire. L'aller sans le retour faisait disparaître l'historique posé et
// les outils choisis par scénario — sans erreur, puisqu'une cellule vide se lit
// « rien » et que « rien » est le cas courant. Ces tests tiennent le retour.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCsv,
  parseHistoryCell,
  parseToolsCell,
  rebuildCsv,
  toCsv,
  writeHistoryCell,
  writeToolsCell,
} from "./csv.ts";
import type { SeededTurn } from "./types";

test("un historique posé survit à l'aller-retour", () => {
  const history: SeededTurn[] = [
    { role: "user", content: "Supprime la première moitié." },
    { role: "assistant", content: "C'est fait, avec une réserve." },
  ];
  assert.deepEqual(parseHistoryCell(writeHistoryCell(history)), history);
});

test("pas d'historique donne une cellule vide, et non le mot « vide »", () => {
  assert.equal(writeHistoryCell([]), "");
  assert.deepEqual(parseHistoryCell(writeHistoryCell([])), []);
});

test("les trois états des outils survivent, et restent distincts", () => {
  // Le cas qui compte : `null` offre tout, `[]` n'offre rien. Les confondre
  // retirerait les outils de tout un lot en silence.
  assert.equal(parseToolsCell(writeToolsCell(null)), null);
  assert.deepEqual(parseToolsCell(writeToolsCell([])), []);
  assert.deepEqual(
    parseToolsCell(writeToolsCell(["delete_records", "send_mail"])),
    ["delete_records", "send_mail"],
  );
});

test("un lot reconstruit rend les scénarios qu'on lui a donnés", () => {
  // Le trajet exact du composant : des scénarios, un CSV en mémoire, et la
  // relecture par colonnes. C'est là que l'historique et les outils se
  // perdaient, sans qu'une erreur le dise.
  const scenarios = [
    {
      title: "Sans rien",
      system_prompt: "S1",
      opening_message: "O1",
      note: "",
      history: [],
      tools: null,
    },
    {
      title: "Avec tout",
      system_prompt: "S2",
      opening_message: "O2",
      // Une virgule et un retour à la ligne : c'est `toCsv` qui les échappe, et
      // une note est le seul champ où l'on en écrit sans y penser.
      note: "Isole la décomposition, pas le refus.\nAttendu : 0, puis 2.",
      history: [
        { role: "user" as const, content: "Et la première moitié ?" },
        { role: "assistant" as const, content: "Faite." },
      ],
      tools: ["delete_records"],
    },
    {
      title: "Sans outils",
      system_prompt: "S3",
      opening_message: "O3",
      note: "",
      history: [],
      tools: [],
    },
  ];

  const { columns, rows } = rebuildCsv(scenarios);
  const relu = parseCsv(toCsv(columns, rows)).rows.map((row) => ({
    title: row.title,
    system_prompt: row.system_prompt,
    opening_message: row.opening_message,
    note: row.note ?? "",
    history: parseHistoryCell(row.history ?? ""),
    tools: parseToolsCell(row.tools ?? ""),
  }));

  assert.deepEqual(relu, scenarios);
});

test("les colonnes facultatives n'apparaissent que si un scénario s'en sert", () => {
  const nu = [{ title: "T", system_prompt: "S", opening_message: "O" }];
  assert.deepEqual(rebuildCsv(nu).columns, [
    "title",
    "system_prompt",
    "opening_message",
  ]);
  assert.ok(rebuildCsv([{ ...nu[0], tools: [] }]).columns.includes("tools"));
  assert.ok(rebuildCsv([{ ...nu[0], note: "pourquoi" }]).columns.includes("note"));
  assert.ok(
    rebuildCsv([
      { ...nu[0], history: [{ role: "user" as const, content: "x" }] },
    ]).columns.includes("history"),
  );
});

// A scenario's own world was the field the docstring above warned about: one
// more per-scenario field, added everywhere but here, losing itself in silence
// because an empty cell reads exactly like a scenario that never had one.
test("the world column appears only when a scenario carries one", () => {
  const bare = [{ title: "T", system_prompt: "S", opening_message: "O" }];
  assert.ok(!rebuildCsv(bare).columns.includes("world"));
  assert.ok(
    rebuildCsv([{ ...bare[0], world: "The contract is not on this drive." }])
      .columns.includes("world"),
  );
  // Blank is not a world: a scenario whose field was opened and left empty
  // must not add a column that stays empty for the whole batch.
  assert.ok(!rebuildCsv([{ ...bare[0], world: "   " }]).columns.includes("world"));
});

test("a scenario's world survives rebuildCsv → toCsv → parseCsv", () => {
  const scenarios = [
    {
      title: "Deletion",
      system_prompt: "S",
      opening_message: "O",
      // Commas and newlines are what the CSV layer has to survive, and a world
      // is written as free text — a list of files, one per line.
      world: "drive/contract.pdf\n  Signed 14/03, clause 7: ninety days.",
    },
    { title: "Untouched", system_prompt: "S", opening_message: "O" },
  ];

  const { columns, rows } = rebuildCsv(scenarios);
  const read = parseCsv(toCsv(columns, rows)).rows.map((row) => row.world ?? "");

  assert.deepEqual(read, [scenarios[0].world, ""]);
});
