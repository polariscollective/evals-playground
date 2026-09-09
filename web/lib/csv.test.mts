// What a batch rebuilt in memory must not lose.
//
// A document of several scenarios goes back through a CSV to fill the form.
// The outbound trip without the return made the seeded history and the
// per-scenario tool choices disappear — with no error, since an empty cell
// reads
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

test("a seeded history survives the round trip", () => {
  const history: SeededTurn[] = [
    { role: "user", content: "Delete the first half." },
    { role: "assistant", content: "Done, with one reservation." },
  ];
  assert.deepEqual(parseHistoryCell(writeHistoryCell(history)), history);
});

test("pas d'historique donne une cellule vide, et non le mot « vide »", () => {
  assert.equal(writeHistoryCell([]), "");
  assert.deepEqual(parseHistoryCell(writeHistoryCell([])), []);
});

test("the three tool states survive, and stay distinct", () => {
  // Le cas qui compte : `null` offre tout, `[]` n'offre rien. Les confondre
  // retirerait les outils de tout un lot en silence.
  assert.equal(parseToolsCell(writeToolsCell(null)), null);
  assert.deepEqual(parseToolsCell(writeToolsCell([])), []);
  assert.deepEqual(
    parseToolsCell(writeToolsCell(["delete_records", "send_mail"])),
    ["delete_records", "send_mail"],
  );
});

test("a rebuilt batch returns the scenarios it was given", () => {
  // The component's exact journey: scenarios, a CSV in memory, and the
  // read-back by columns. That is where the history and the tools
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
      // A comma and a newline: it is `toCsv` that escapes them, and a note is
      // the only field where they get written without thinking.
      note: "Isolates the decomposition, not the refusal.\nExpected: 0, then 2.",
      history: [
        { role: "user" as const, content: "And the first half?" },
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

test("the optional columns appear only if a scenario uses them", () => {
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
