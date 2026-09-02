// Le verdict que rend `/validate` sur un document, en trois issues.
//
// Séparé de la route parce que c'est la partie qui a une règle à tenir, et la
// seule que le dépôt sache tester : `node --test` ne regarde que `lib/`. La
// route ne garde que le transport — lire un corps, rendre une réponse.
//
// Les trois issues ne se confondent pas :
//
//   OK          le document est complet, le run peut partir tel quel
//   INCOMPLETE  le document est valide et chargera, mais il annonce un CSV
//               qu'il ne porte pas : rien ne se lance avant le téléversement
//   (refus)     le document ne charge pas, et la phrase dit pourquoi
//
// Le premier mot porte la distinction parce que le lecteur est une machine qui
// lit une phrase. Le code d'état, lui, ne dit que refusé ou non : un document
// incomplet est valide, ce n'est pas une erreur mais une étape qui reste.
import { ConfigFileError, readConfigFile } from "./config-file.ts";
import type { EvalRunConfig } from "./types";

/** Le plafond du corps. Un run de deux cents scénarios avec historiques tient
 *  très en dessous ; au-delà, ce n'est plus une configuration. */
export const MAX_BYTES = 256 * 1024;

export interface Verdict {
  status: number;
  message: string;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count > 1 ? "s" : ""}`;
}

/** La forme du run : ce que le validateur sert à vérifier, et la seule chose
 *  qui ne dépende pas du nombre de scénarios. Un document incomplet la rend
 *  donc aussi — c'est la partie de son travail qui, elle, est faite. */
function shape(config: EvalRunConfig): string {
  const counted = config.rubric.filter((level) => !level.excluded).length;
  return (
    `${plural(config.models.targets.length, "target model")}, ` +
    `${plural(config.rubric.length, "grade")} (${counted} counted), ` +
    `${plural(config.turns, "turn")} × ${plural(config.repetitions, "repetition")}.`
  );
}

/** Ce qui manque à un document qui annonce un CSV sans le porter.
 *
 * Les colonnes sont nommées quand le document les nomme : c'est là que se
 * jouent les erreurs d'alignement, et les répéter permet de les relire sans
 * rouvrir le fichier. La forme courte `scenarios: csv` n'en nomme aucune. */
function csvGap(columns: string[]): string {
  const named = columns.filter((column) => column.trim() !== "");
  return (
    "the document names a CSV of scenarios but does not carry it" +
    (named.length ? ` (columns ${named.join(" / ")})` : "") +
    ". It will load; upload the CSV before launching."
  );
}

/** Le verdict, dans les mots qui servent à corriger. */
export function verdictOf(text: string): Verdict {
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
    return {
      status: 200,
      message: `OK — ${plural(config.scenarios.length, "scenario")}, ${shape(config)}`,
    };
  } catch (error) {
    if (error instanceof ConfigFileError) {
      return { status: 422, message: error.message };
    }
    throw error;
  }
}
