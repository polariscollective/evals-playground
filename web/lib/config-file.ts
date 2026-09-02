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
  SeededTurn,
  ToolParamType,
  ToolSpec,
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
    // L'historique posé, propre à ce scénario. Absent la plupart du temps, et
    // absent du fichier écrit quand il l'est : un tableau vide partout ferait
    // du bruit dans un gabarit.
    history: readHistory(row.history, position),
    // Trois états à préserver : absent offre tous les outils du run, une liste
    // offre ceux-là, `none` n'en offre aucun. Les confondre ferait disparaître
    // la comparaison « la même ligne, avec et sans outils ».
    tools: readScenarioTools(row.tools, position),
  };
}

function readScenarioTools(value: unknown, position: number): string[] | null {
  if (value === undefined || value === null) return null;
  // `tools: none` est la façon lisible de dire « aucun » dans un fichier écrit
  // à la main. YAML rendrait `~` ou `null`, qui veut dire « absent » — donc
  // « tous » — et l'écart entre les deux est exactement ce qui compte ici.
  if (value === "none") return [];
  if (!Array.isArray(value)) {
    throw new ConfigFileError(
      `scenario ${position}: tools must be a list of names, or \`none\`.`,
    );
  }
  return value.map((name) => asString(name));
}

function readHistory(value: unknown, position: number): SeededTurn[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ConfigFileError(`scenario ${position}: history must be a list.`);
  }
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ConfigFileError(
        `scenario ${position}: history turn ${index + 1} is not a mapping.`,
      );
    }
    const turn = entry as Record<string, unknown>;
    const role = asString(turn.role);
    if (role !== "user" && role !== "assistant") {
      throw new ConfigFileError(
        `scenario ${position}: history turn ${index + 1} needs a role of user or assistant.`,
      );
    }
    return { role, content: asString(turn.content ?? turn.message) };
  });
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

function readTools(value: unknown): ToolSpec[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new ConfigFileError("tools must be a list.");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ConfigFileError(`tool ${index + 1} is not a mapping.`);
    }
    const tool = entry as Record<string, unknown>;
    const params = tool.parameters;
    return {
      name: asString(tool.name),
      description: asString(tool.description),
      parameters: Array.isArray(params)
        ? params.map((param) => {
            const row = (param ?? {}) as Record<string, unknown>;
            return {
              name: asString(row.name),
              type: (asString(row.type) || "string") as ToolParamType,
              description: asString(row.description),
              required: row.required === true,
            };
          })
        : [],
      result: asString(tool.result ?? tool.output),
    };
  });
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
    tools: readTools(file.tools),
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
 * Les scénarios sont toujours écrits, y compris quand ils viennent d'un CSV. La
 * forme `from: csv` existe pour qu'un agent puisse annoncer un fichier qu'il n'a
 * pas ; s'en servir ici produirait un fichier qui ne se suffit pas, et qui ne
 * dirait même pas de quel CSV il parle. Le fichier peut être long — c'est un
 * export, pas un gabarit, et le gabarit est ailleurs.
 *
 * La provenance survit en commentaire : elle ne se relit pas, mais elle répond à
 * « d'où sortent ces trente scénarios » six mois plus tard. */
export function writeConfigFile(config: EvalRunConfig): string {
  const source = config.source;
  // Les clés dans l'ordre où le prompt les présente, et non celui de l'objet :
  // un gabarit qu'on lit de haut en bas doit commencer par ce qui identifie le
  // run, et finir par les scénarios, qui sont la partie longue.
  const document = {
    label: config.label ?? "",
    notes: config.notes ?? "",
    criterion: config.criterion,
    // `excluded: false` sur chaque palier serait du bruit : c'est le défaut du
    // lecteur, et un fichier qui l'écrit partout enseigne un champ là où il ne
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
    ...(config.tools && config.tools.length > 0 ? { tools: config.tools } : {}),
    scenarios: config.scenarios.map((scenario) =>
      scenario.history && scenario.history.length > 0
        ? scenario
        : // Un `history: []` partout alourdirait le gabarit sans rien dire.
          {
            title: scenario.title,
            system_prompt: scenario.system_prompt,
            opening_message: scenario.opening_message,
            ...(scenario.tools == null
              ? {}
              : { tools: scenario.tools.length === 0 ? "none" : scenario.tools }),
          },
    ),
  };

  const entete = ["# evals-playground — load this file back with « Load a config file »."];
  if (source?.kind === "csv") {
    entete.push(
      `# The ${config.scenarios.length} scenarios below were read from` +
        ` ${source.file_name || "a CSV"}` +
        (source.column_title
          ? `, columns ${source.column_title} / ${source.column_system_prompt}` +
            ` / ${source.column_opening_message}.`
          : "."),
    );
  }

  return (
    entete.join("\n") +
    "\n" +
    // Sans `lineWidth: 0`, une longue consigne serait repliée sur plusieurs
    // lignes : relue, elle serait identique, mais illisible pour qui l'édite.
    stringify(document, { lineWidth: 0 })
  );
}
