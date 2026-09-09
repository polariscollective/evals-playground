// The verdict on a document, in three outcomes.
//
// Separated from the route because it is the part that holds a rule, and the
// only part the repository knows how to test: `node --test` looks only at
// `lib/`. The route keeps the transport alone — read a body, return a response.
//
// The three outcomes are not to be confused:
//
//   OK          the document is complete, the run can leave as it stands
//   INCOMPLETE  the document is valid and will load, but it announces a CSV
//               it does not carry: nothing launches before the upload
//   (refusal)   the document does not load, and the sentence says why
//
// The first word carries the distinction because the reader is a machine
// reading a sentence. The status code says only refused or not: an incomplete
// document is valid, not an error but a step that remains.
import { ConfigFileError, readConfigFile } from "./config-file.ts";
import type { EvalRunConfig } from "./types";

/** The body's cap. A run of two hundred scenarios with histories fits well
 *  below it; beyond that, it is no longer a configuration. */
export const MAX_BYTES = 256 * 1024;

export interface Verdict {
  status: number;
  message: string;
}

/** What it takes to price the run, passed in from outside.
 *
 * `pricing.ts` is a heavier dependency than the rest of this module — it reads
 * `shared/pricing.json` and computes the quote. Importing it here would sew
 * that weight onto a module that otherwise only compares numbers, and that
 * stays trivially testable as a result. The route passes `costSentence`, the
 * tests pass whatever they like. */
export type Pricer = (config: EvalRunConfig) => string | null;

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}

/** The run's shape: what the validator serves to check, and the only thing
 *  that does not depend on the number of scenarios. An incomplete document
 *  therefore returns it too — the part of its work that is done. */
function shape(config: EvalRunConfig): string {
  const counted = config.rubric.filter((level) => !level.excluded).length;
  // The number of judges is returned because it is the only way to see a
  // misspelled key: `judge:` instead of `judges:` is swallowed without a word —
  // like any key this format does not define — and the document then runs with
  // one judge fewer than was thought to have been written. The count includes
  // the principal and, if it is on, the awareness judge: it is the number of
  // model calls per conversation being paid for.
  const awareness = config.check_eval_awareness === false ? 0 : 1;
  const judges = 1 + (config.judges?.length ?? 0) + awareness;
  return (
    `${plural(config.models.targets.length, "target model")}, ` +
    `${plural(judges, "judge")} (eval-awareness ${awareness ? "on" : "off"}), ` +
    `${plural(config.rubric.length, "grade")} (${counted} counted), ` +
    `${plural(config.turns, "turn")} × ${plural(config.repetitions, "repetition")}.`
  );
}

/** What is missing from a document announcing a CSV without carrying it.
 *
 * The columns are named when the document names them: that is where alignment
 * errors happen, and repeating them makes it possible to read them back without
 * reopening the file. The short form `scenarios: csv` names none. */
function csvGap(columns: string[]): string {
  const named = columns.filter((column) => column.trim() !== "");
  return (
    "the document names a CSV of scenarios but does not carry it" +
    (named.length ? ` (columns ${named.join(" / ")})` : "") +
    ". It will load; upload the CSV before launching."
  );
}

/** The verdict, in the words that serve to correct it. */
export function verdictOf(text: string, priceOf?: Pricer): Verdict {
  if (text.trim() === "") {
    return { status: 400, message: "Nothing to validate. Send the YAML document." };
  }
  if (new TextEncoder().encode(text).length > MAX_BYTES) {
    return { status: 413, message: `The document is over ${MAX_BYTES / 1024} kB.` };
  }

  try {
    const { config, csv } = readConfigFile(text);
    if (csv) {
      return {
        status: 200,
        message:
          `INCOMPLETE — ${csvGap([
            csv.column_title,
            csv.column_system_prompt,
            csv.column_opening_message,
          ])} ` + shape(config),
      };
    }
    // The price goes only to a complete document: a document announcing a CSV
    // has no scenario, and the cost is precisely what depends on their number —
    // the one figure the run's shape does not carry.
    const price = priceOf?.(config) ?? null;
    return {
      status: 200,
      message:
        `OK — ${plural(config.scenarios.length, "scenario")}, ${shape(config)}` +
        (price ? ` ${price}` : ""),
    };
  } catch (error) {
    if (error instanceof ConfigFileError) {
      return { status: 422, message: error.message };
    }
    throw error;
  }
}
