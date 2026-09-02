/** Lecture d'un CSV dans le navigateur, sans dépendance.

   Gère le séparateur virgule, les champs entre guillemets contenant des
   virgules ou des retours à la ligne, et les guillemets échappés par
   doublement. Une ligne dont le nombre de champs ne correspond pas à
   l'en-tête est écartée et comptée — l'écarter en silence serait pire que
   la refuser, l'utilisateur croirait avoir chargé plus de scénarios qu'il
   n'en a réellement. */

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

/** Écrit un CSV lisible par `parseCsv` et par un tableur.
 *
 * Sert à reconstituer le lot d'un run lancé avant que le fichier téléversé ne
 * soit conservé : les scénarios, eux, sont dans le record, et le CSV
 * reconstruit a exactement le même contenu que l'original. */
export function toCsv(columns: string[], rows: Record<string, string>[]): string {
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [
    columns.map(cell).join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column] ?? "")).join(",")),
  ].join("\n");
}

/** L'historique posé d'un scénario, lu dans une cellule de CSV.
 *
 * Du JSON dans une cellule est laid, et c'est le moins mauvais choix : un
 * échange de six tours ne se met pas en colonnes sans figer leur nombre, et une
 * cellule vide reste la règle — la plupart des scénarios n'ont pas d'historique.
 *
 * Une cellule illisible rend une liste vide plutôt que de faire échouer tout le
 * fichier : le scénario part sans historique, ce que l'écran annonce. Refuser le
 * lot entier pour une ligne mal échappée coûterait plus que ça ne protège. */
export function parseHistoryCell(cell: string): SeededTurn[] {
  const texte = (cell ?? "").trim();
  if (texte === "") return [];
  try {
    const brut = JSON.parse(texte);
    if (!Array.isArray(brut)) return [];
    return brut
      .map((turn) => ({
        role: turn?.role === "assistant" ? "assistant" : "user",
        content: String(turn?.content ?? ""),
      }))
      .filter((turn) => turn.content !== "") as SeededTurn[];
  } catch {
    return [];
  }
}

/** Les outils d'un scénario, lus dans une cellule de CSV.
 *
 * Trois états à faire tenir dans une cellule : vide offre tous les outils du
 * run — c'est le cas courant et l'absence de valeur doit donc être inoffensive ;
 * `none` n'en offre aucun ; sinon les noms, séparés par des virgules.
 *
 * Le mot `none` plutôt qu'une cellule vide pour « aucun » : une colonne
 * fraîchement ajoutée est vide partout, et si le vide voulait dire « aucun »,
 * l'ajouter retirerait silencieusement les outils de tout le lot. */
export function parseToolsCell(cell: string): string[] | null {
  const texte = (cell ?? "").trim();
  if (texte === "") return null;
  if (texte.toLowerCase() === "none") return [];
  return texte
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

/** L'inverse de `parseHistoryCell`, pour un lot reconstruit en mémoire.
 *
 * Elle manquait, et son absence se voyait mal : un document de plusieurs
 * scénarios repasse par un CSV pour remplir le formulaire, et l'historique
 * posé disparaissait en silence entre le document et le run. Silence est le
 * mot — `parseHistoryCell` d'une cellule vide rend une liste vide, qui est
 * exactement ce qu'un scénario sans historique rend aussi. */
export function writeHistoryCell(history: SeededTurn[]): string {
  return history.length === 0 ? "" : JSON.stringify(history);
}

/** L'inverse de `parseToolsCell`, et ses trois états.
 *
 * `null` offre tous les outils du run, une liste vide n'en offre aucun, sinon
 * les noms. Les virgules séparent sans risque : un nom d'outil est limité aux
 * lettres, aux chiffres, au tiret et au souligné. */
export function writeToolsCell(tools: string[] | null): string {
  if (tools === null) return "";
  if (tools.length === 0) return "none";
  return tools.join(",");
}

/** Les colonnes toujours présentes dans un CSV reconstruit. */
const REBUILT_COLUMNS = ["title", "system_prompt", "opening_message"];

/** Un lot de scénarios remis sous la forme que le formulaire sait tenir.
 *
 * Le mode manuel ne porte qu'un scénario : au-delà, un document — collé,
 * chargé, ou repris d'un vieux run dont le CSV n'a pas été gardé — repasse par
 * un CSV reconstruit en mémoire. Ce détour ne doit rien perdre en route, et il
 * perdait tout ce qui n'est pas l'un des trois champs obligatoires : la note de
 * laboratoire, l'historique posé, les outils choisis par scénario. Rien ne le
 * signalait — une cellule vide se lit « pas de note », « pas d'historique » et
 * « tous les outils », qui sont précisément ce qu'un scénario sans rien de tout
 * cela rend aussi.
 *
 * Chaque colonne facultative n'apparaît que si un scénario s'en sert : vides sur
 * tout un lot, elles n'apprendraient rien et alourdiraient le panneau des
 * colonnes pour le cas courant, qui n'en a aucune.
 *
 * Un champ de plus par scénario, un jour, se rajoute ici — et l'oublier ne
 * casse rien de visible, ce qui est exactement le danger. */
export function rebuildCsv(scenarios: EvalScenario[]): {
  columns: string[];
  rows: Record<string, string>[];
} {
  const columns = [
    ...REBUILT_COLUMNS,
    ...(scenarios.some((s) => s.note) ? ["note"] : []),
    ...(scenarios.some((s) => (s.history?.length ?? 0) > 0) ? ["history"] : []),
    ...(scenarios.some((s) => s.tools != null) ? ["tools"] : []),
  ];
  return {
    columns,
    rows: scenarios.map((scenario) => ({
      title: scenario.title,
      system_prompt: scenario.system_prompt,
      opening_message: scenario.opening_message,
      // Du texte libre, qui n'a pas besoin d'être encodé : `toCsv` échappe les
      // virgules et les retours à la ligne, `parseCsv` les rend.
      note: scenario.note ?? "",
      history: writeHistoryCell(scenario.history ?? []),
      tools: writeToolsCell(scenario.tools ?? null),
    })),
  };
}
