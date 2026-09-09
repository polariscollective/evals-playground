/** Reading a CSV in the browser, with no dependency.

   Handles the comma separator, quoted fields holding commas or newlines, and
   quotes escaped by doubling. A row whose field count does not match the header
   is set aside and counted — setting it aside in silence would be worse than
   refusing it, the user would believe they had loaded more scenarios than they
   really have. */

import type { EvalScenario, SeededTurn } from "./types";

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
  skipped: number;
}

function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // A \r\n must count for one end of line only.
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function parseCsv(text: string): ParsedCsv {
  const records = splitRecords(text);
  if (records.length === 0) return { columns: [], rows: [], skipped: 0 };

  const columns = records[0].map((c) => c.trim());
  const rows: Record<string, string>[] = [];
  let skipped = 0;

  for (const record of records.slice(1)) {
    if (record.length !== columns.length) {
      skipped += 1;
      continue;
    }
    const row: Record<string, string> = {};
    columns.forEach((column, index) => {
      row[column] = record[index];
    });
    rows.push(row);
  }

  return { columns, rows, skipped };
}

/** Writes a CSV readable by `parseCsv` and by a spreadsheet.
 *
 * Used to rebuild the batch of a run launched before the uploaded file was
 * kept: the scenarios themselves are in the record, and the rebuilt CSV has
 * exactly the same content as the original. */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [
    columns.map(cell).join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column] ?? "")).join(",")),
  ].join("\n");
}

/** A scenario's seeded history, read from a CSV cell.
 *
 * JSON in a cell is ugly, and it is the least bad choice: a six-turn exchange
 * does not go into columns without freezing their number, and an empty cell
 * stays the rule — most scenarios have no history.
 *
 * An unreadable cell returns an empty list rather than failing the whole file:
 * the scenario leaves without history, which the screen announces. Refusing the
 * whole batch for one badly escaped row would cost more than it protects. */
export function parseHistoryCell(cell: string): SeededTurn[] {
  const text = (cell ?? "").trim();
  if (text === "") return [];
  try {
    const raw = JSON.parse(text);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((turn) => ({
        role: turn?.role === "assistant" ? "assistant" : "user",
        content: String(turn?.content ?? ""),
      }))
      .filter((turn) => turn.content !== "") as SeededTurn[];
  } catch {
    return [];
  }
}

/** A scenario's tools, read from a CSV cell.
 *
 * Three states to fit in one cell: empty offers all the run's tools — that is
 * the common case, so the absence of a value must be harmless; `none` offers
 * none; otherwise the names, separated by commas.
 *
 * The word `none` rather than an empty cell for "none at all": a freshly added
 * column is empty everywhere, and if empty meant "none", adding it would
 * silently withdraw the tools from the whole batch. */
export function parseToolsCell(cell: string): string[] | null {
  const text = (cell ?? "").trim();
  if (text === "") return null;
  if (text.toLowerCase() === "none") return [];
  return text
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** The inverse of `parseHistoryCell`, for a batch rebuilt in memory.
 *
 * It was missing, and its absence showed badly: a document of several scenarios
 * goes back through a CSV to fill the form, and the seeded history was
 * vanishing silently between the document and the run. Silently is the word —
 * `parseHistoryCell` of an empty cell returns an empty list, which is exactly
 * what a scenario with no history returns too. */
export function writeHistoryCell(history: SeededTurn[]): string {
  return history.length === 0 ? "" : JSON.stringify(history);
}

/** The inverse of `parseToolsCell`, and its three states.
 *
 * `null` offers all the run's tools, an empty list offers none, otherwise the
 * names. The commas separate without risk: a tool's name is limited to letters,
 * digits, the dash and the underscore. */
export function writeToolsCell(tools: string[] | null): string {
  if (tools === null) return "";
  if (tools.length === 0) return "none";
  return tools.join(",");
}

/** The columns always present in a rebuilt CSV. */
const REBUILT_COLUMNS = ["title", "system_prompt", "opening_message"];

/** A batch of scenarios put back into the shape the form knows how to hold.
 *
 * Manual mode carries only one scenario: beyond that, a document — pasted,
 * loaded, or taken from an old run whose CSV was not kept — goes back through a
 * CSV rebuilt in memory. That detour must lose nothing on the way, and it was
 * losing everything that is not one of the three mandatory fields: the
 * laboratory note, the seeded history, the tools chosen per scenario. Nothing
 * reported it — an empty cell reads as "no note", "no history" and "all the
 * tools", which are precisely what a scenario with none of that returns too.
 *
 * Each optional column appears only if a scenario uses it: empty across a whole
 * batch, they would teach nothing and would weigh down the column panel for the
 * common case, which has none of them.
 *
 * One more field per scenario, one day, gets added here — and forgetting it
 * breaks nothing visible, which is exactly the danger. */
export function rebuildCsv(scenarios: EvalScenario[]): {
  columns: string[];
  rows: Record<string, string>[];
} {
  const columns = [
    ...REBUILT_COLUMNS,
    ...(scenarios.some((s) => s.note) ? ["note"] : []),
    // Trimmed, unlike `note` above: a world is offered as a wide textarea and
    // comes back full of whitespace from a field someone opened and left. A
    // column of blanks across a whole batch teaches nothing.
    ...(scenarios.some((s) => s.world?.trim()) ? ["world"] : []),
    ...(scenarios.some((s) => (s.history?.length ?? 0) > 0) ? ["history"] : []),
    ...(scenarios.some((s) => s.tools != null) ? ["tools"] : []),
  ];
  return {
    columns,
    rows: scenarios.map((scenario) => ({
      title: scenario.title,
      system_prompt: scenario.system_prompt,
      opening_message: scenario.opening_message,
        // Free text, which needs no encoding: `toCsv` escapes the commas and
        // the newlines, `parseCsv` gives them back.
      note: scenario.note ?? "",
      world: scenario.world ?? "",
      history: writeHistoryCell(scenario.history ?? []),
      tools: writeToolsCell(scenario.tools ?? null),
    })),
  };
}
