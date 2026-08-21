// Lire un run décrit dans un fichier, JSON ou YAML.
//
// L'idée est qu'un agent puisse écrire la configuration d'un run — scénarios,
// échelle, modèles — et qu'on la dépose telle quelle dans le formulaire. Ce qui
// est demandé ici est exactement la forme stockée dans `eval_runs.config` : une
// seule forme à apprendre, et un run exporté se réimporte sans traduction.
//
// Un seul analyseur pour les deux formats : JSON 1.2 est un sous-ensemble de
// YAML, et `parse` avale donc les deux. Il vit côté serveur pour rester hors du
// paquet envoyé au navigateur, et pour que la validation reste celle qui fait
// autorité.
import { parse, stringify } from "yaml";
import { configProblem } from "./validate.ts";
import type {
  EvalRunConfig,
  EvalScenario,
  ExpectedCsv,
  RubricLevel,
} from "./types";

export interface ImportedConfig {
  /** Les scénarios sont vides quand le fichier annonce un CSV. */
  config: EvalRunConfig;
  csv: ExpectedCsv | null;
}

/** Levée telle quelle vers l'utilisateur : son message doit se lire. */
export class ConfigFileError extends Error {}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function scenarioOf(entry: unknown, position: number): EvalScenario {
  if (!entry || typeof entry !== "object") {
    throw new ConfigFileError(`scenario ${position} is not a mapping.`);
  }
  const row = entry as Record<string, unknown>;
  return {
    title: asString(row.title),
    system_prompt: asString(row.system_prompt ?? row.system),
    opening_message: asString(row.opening_message ?? row.opening ?? row.message),
  };
}

/** La partie « scénarios » du fichier : une liste, ou l'annonce d'un CSV. */
function readScenarios(value: unknown): {
  scenarios: EvalScenario[];
  csv: ExpectedCsv | null;
} {
  // `scenarios: csv` — la forme la plus courte, quand les colonnes portent les
  // noms qu'on devinera de toute façon au téléversement.
  if (value === "csv") {
    return {
      scenarios: [],
      csv: {
        column_title: "",
        column_system_prompt: "",
        column_opening_message: "",
      },
    };
  }

  if (Array.isArray(value)) {
    return { scenarios: value.map(scenarioOf), csv: null };
  }

  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (asString(row.from ?? row.kind) !== "csv") {
      throw new ConfigFileError(
        'scenarios must be a list, or a mapping with `from: csv`.',
      );
    }
    return {
      scenarios: [],
      csv: {
        column_title: asString(row.column_title ?? row.title),
        column_system_prompt: asString(row.column_system_prompt ?? row.system),
        column_opening_message: asString(
          row.column_opening_message ?? row.opening ?? row.message,
        ),
      },
    };
  }

  throw new ConfigFileError("scenarios is missing.");
}

function readRubric(value: unknown): RubricLevel[] {
  if (!Array.isArray(value)) throw new ConfigFileError("rubric is missing.");
  return value.map((entry, position) => {
    if (!entry || typeof entry !== "object") {
      throw new ConfigFileError(`grade ${position} is not a mapping.`);
    }
    const row = entry as Record<string, unknown>;
    return {
      value: asNumber(row.value, NaN),
      meaning: asString(row.meaning ?? row.description),
      // Un palier « sans objet » : le juge peut le choisir, la moyenne
      // l'ignore.
      excluded: row.excluded === true,
    };
  });
}

/** Le fichier, lu et validé, ou une erreur qui dit ce qui manque. */
export function readConfigFile(text: string): ImportedConfig {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new ConfigFileError(`Could not read the file: ${(error as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigFileError("The file must describe a single run.");
  }
  const file = raw as Record<string, unknown>;

  const { scenarios, csv } = readScenarios(file.scenarios);
  const models = (file.models ?? {}) as Record<string, unknown>;
  const temperature = file.temperature as
    | { min?: unknown; max?: unknown }
    | null
    | undefined;

  const config: EvalRunConfig = {
    scenarios,
    criterion: asString(file.criterion),
    rubric: readRubric(file.rubric),
    turns: asNumber(file.turns, 1),
    repetitions: asNumber(file.repetitions, 1),
    models: {
      targets: Array.isArray(models.targets)
        ? models.targets.map((target) => asString(target))
        : [],
      adversary: asString(models.adversary) || null,
      judge: asString(models.judge),
    },
    adversary_prompt: asString(file.adversary_prompt),
    temperature: temperature
      ? {
          min: asNumber(temperature.min, 1),
          max:
            typeof temperature.max === "number" ? temperature.max : null,
        }
      : null,
    label: asString(file.label) || null,
    notes: asString(file.notes),
  };

  // La validation est celle du lancement, sans exception : un fichier qui
  // passerait ici pour échouer au moment de lancer ne rendrait service à
  // personne. Le scénario factice tient la place de ceux qu'apportera le CSV,
  // et n'est jamais conservé.
  const problem = configProblem(
    csv
      ? {
          ...config,
          scenarios: [
            { title: "csv", system_prompt: "csv", opening_message: "csv" },
          ],
        }
      : config,
  );
  if (problem) throw new ConfigFileError(problem);

  return { config, csv };
}

/** Le chemin inverse : une configuration écrite dans un fichier redéposable.
 *
 * En YAML et non en JSON, parce que c'est ce que le prompt demande à l'agent :
 * deux formats pour les deux sens de la même conversion serait une bizarrerie de
 * plus à expliquer. L'écriture passe par le serveur pour la même raison que la
 * lecture — l'analyseur reste hors du paquet du navigateur.
 *
 * Quand les scénarios viennent d'un CSV, le fichier dit d'où ils viennent au
 * lieu de les recopier : recopier trente scénarios dans un gabarit en ferait un
 * mauvais gabarit, et le CSV existe déjà. */
export function writeConfigFile(
  config: EvalRunConfig,
  fromCsv: boolean,
): string {
  const source = config.source;
  // Les clés dans l'ordre où le prompt les présente, et non celui de l'objet :
  // un gabarit qu'on lit de haut en bas doit commencer par ce qui identifie le
  // run, et finir par les scénarios, qui sont la partie longue.
  const document = {
    label: config.label ?? "",
    notes: config.notes ?? "",
    criterion: config.criterion,
    // `excluded: false` sur chaque palier serait du bruit : c'est le défaut du
    // lecteur, et un gabarit qui l'écrit partout enseigne un champ là où il ne
    // sert pas.
    rubric: config.rubric.map((level) =>
      level.excluded
        ? { value: level.value, meaning: level.meaning, excluded: true }
        : { value: level.value, meaning: level.meaning },
    ),
    turns: config.turns,
    repetitions: config.repetitions,
    temperature: config.temperature ?? null,
    models: config.models,
    adversary_prompt: config.adversary_prompt,
    scenarios: fromCsv
      ? {
          from: "csv",
          column_title: source?.column_title ?? "",
          column_system_prompt: source?.column_system_prompt ?? "",
          column_opening_message: source?.column_opening_message ?? "",
        }
      : config.scenarios,
  };
  return (
    "# evals-playground — load this file back with « Load a config file ».\n" +
    (fromCsv
      ? "# The scenarios come from a CSV, which you upload separately.\n"
      : "") +
    // Sans `lineWidth: 0`, une longue consigne serait repliée sur plusieurs
    // lignes : relue, elle serait identique, mais illisible pour qui l'édite.
    stringify(document, { lineWidth: 0 })
  );
}
