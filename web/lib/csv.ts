/** Lecture d'un CSV dans le navigateur, sans dépendance.

   Gère le séparateur virgule, les champs entre guillemets contenant des
   virgules ou des retours à la ligne, et les guillemets échappés par
   doublement. Une ligne dont le nombre de champs ne correspond pas à
   l'en-tête est écartée et comptée — l'écarter en silence serait pire que
   la refuser, l'utilisateur croirait avoir chargé plus de scénarios qu'il
   n'en a réellement. */

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
      // Un \r\n ne doit compter que pour une fin de ligne.
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
