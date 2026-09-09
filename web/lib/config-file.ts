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
import { served, writesWorld } from "./tools.ts";
import { configProblem } from "./validate.ts";
import type {
  EvalRunConfig,
  EvalScenario,
  ExpectedCsv,
  JudgeSpec,
  JudgeTarget,
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

/** Absent, le champ prend son défaut ; présent, il passe tel quel — même mal
 *  typé — pour que `configProblem` puisse le refuser.
 *
 *  Coercer ici rendait la faute invisible : `turns: "4"`, un 4 mis entre
 *  guillemets comme YAML y invite, retombait sur le défaut 1 et le document
 *  passait, puisqu'à un seul tour l'adversaire n'est plus exigé. On recevait
 *  un run à un tour en croyant en avoir commandé quatre. Même raisonnement
 *  que pour `check_eval_awareness` plus bas : ce fichier lit, il ne juge pas. */
function asGiven(value: unknown, fallback: number): number {
  return value === undefined || value === null ? fallback : (value as number);
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
    note: asString(row.note),
    // Ce que cette ligne change au monde du run. Ajouté au sien comme un bloc
    // nommé et prioritaire, jamais fondu dedans : c'est ce qui rend une
    // négation sûre plutôt qu'une contradiction à démêler.
    world: asString(row.world),
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
      // Le discriminant des deux formes. Renseigné, l'outil est servi depuis
      // le monde ; vide, il rend `result` sans qu'aucun modèle ne soit appelé.
      // `configProblem` refuse les deux ensemble.
      retrieval_rules: asString(tool.retrieval_rules),
      // Le second discriminant, indépendant du premier : ce que l'appeler
      // CHANGE au monde. Renseigné, l'appel entre au journal de la
      // conversation et les lectures qui suivent en tiennent compte. Un outil
      // fixe peut le porter — c'est même la forme courante.
      world_effect: asString(tool.world_effect),
    };
  });
}

/** `where` situe l'erreur : `"rubric"` pour l'échelle du principal, au
 *  premier niveau ; `"judge 2: rubric"` pour celle d'un juge secondaire —
 *  voir `readJudges`. Les deux lisent la même forme, donc le même code. */
function readRubric(value: unknown, where = "rubric"): RubricLevel[] {
  // Deux torts différents, deux messages : « missing » pour une échelle
  // absente, et ce qu'on attend pour une échelle présente mais mal formée —
  // une table de paliers, ou un autre nom de clé, disaient tous les deux
  // « missing », ce qui envoyait chercher au mauvais endroit.
  if (value === undefined || value === null) {
    throw new ConfigFileError(`${where} is missing.`);
  }
  if (!Array.isArray(value)) {
    throw new ConfigFileError(
      `${where} must be a list of grades, each with a \`value\` and a \`meaning\`.`,
    );
  }
  return value.map((entry, position) => {
    if (!entry || typeof entry !== "object") {
      throw new ConfigFileError(`${where}: grade ${position} is not a mapping.`);
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

/** La forme d'une échelle telle qu'on l'écrit dans le fichier : `excluded`
 *  omis quand il vaut `false`, le défaut du lecteur — l'écrire partout
 *  serait du bruit et enseignerait un champ là où il ne sert pas. Partagée
 *  entre l'échelle du principal et celle de chaque juge secondaire : les
 *  deux doivent s'écrire pareil, et un seul endroit le garantit. */
function rubricDocument(rubric: RubricLevel[]): unknown[] {
  return rubric.map((level) =>
    level.excluded
      ? { value: level.value, meaning: level.meaning, excluded: true }
      : { value: level.value, meaning: level.meaning },
  );
}

/** Les juges secondaires du run, en plus du principal — voir `JudgeSpec`
 *  dans `types.ts`.
 *
 * Absent ou vide : la forme ancienne, celle de tous les fichiers déjà
 * écrits — `criterion`/`rubric` au premier niveau restent le seul juge, et
 * décrivent le principal. Chaque entrée ici en ajoute un de plus, toujours
 * ordinaire : `JudgeSpec` ne porte ni type système ni marque de principal,
 * donc aucune entrée ne peut se réclamer de l'un ou de l'autre — une clé
 * comme `system_type` ou `is_principal`, glissée ici par erreur ou par un
 * agent qui n'a pas compris le format, n'est simplement jamais lue, comme
 * toute autre clé inconnue dans ce fichier.
 *
 * La validation sémantique (un critère non vide, une échelle qui tient,
 * deux paliers comptés) est laissée à `configProblem`, appelé à la fin de
 * `readConfigFile` — exactement comme pour le principal et pour les outils :
 * ce qui est lu ici ne fait que donner une forme, jamais un jugement. */
function readJudges(value: unknown): JudgeSpec[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ConfigFileError("judges must be a list.");
  }
  return value.map((entry, position) => {
    if (!entry || typeof entry !== "object") {
      throw new ConfigFileError(`judge ${position + 1} is not a mapping.`);
    }
    const row = entry as Record<string, unknown>;
    const model = row.model;
    // Comme `check_eval_awareness` : un type qui n'est pas le bon ne se
    // devine pas. `asString` effacerait silencieusement un nombre ou un
    // booléen glissé ici en chaîne vide, et le juge tournerait avec le
    // modèle par défaut du run sans que personne ne l'ait demandé.
    if (model !== undefined && model !== null && typeof model !== "string") {
      throw new ConfigFileError(`judge ${position + 1}: model must be text.`);
    }
    return {
      criterion: asString(row.criterion),
      rubric: readRubric(row.rubric, `judge ${position + 1}: rubric`),
      ...(typeof model === "string" ? { model } : {}),
      ...readTargets(row.targets, `judge ${position + 1}`),
      ...(typeof row.sees_system_prompt === "boolean"
        ? { sees_system_prompt: row.sees_system_prompt }
        : {}),
    };
  });
}

/** Les cibles d'un juge, telles qu'elles sont écrites dans le document.
 *
 * Rend un objet à étaler plutôt qu'une valeur : absent doit rester ABSENT et
 * non `null`, sans quoi une configuration relue puis réécrite gagnerait une
 * clé que personne n'a posée.
 *
 * La forme seulement — la longueur de la liste et l'appartenance de chaque
 * note à l'échelle sont l'affaire de `targetsProblem` (`lib/targets.ts`),
 * appelé par `configProblem`. Ici comme partout dans ce fichier, on donne une
 * forme, jamais un jugement : deux copies de la même règle finiraient par
 * diverger, et c'est la validation qui fait foi. */
function readTargets(
  value: unknown,
  where: string,
): { targets?: JudgeTarget[] } {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) {
    throw new ConfigFileError(`${where}: targets must be a list.`);
  }
  return {
    targets: value.map((entry, position) => {
      if (!entry || typeof entry !== "object") {
        throw new ConfigFileError(
          `${where}: targets ${position + 1} is not a mapping.`,
        );
      }
      const row = entry as Record<string, unknown>;
      if (typeof row.expected !== "number") {
        throw new ConfigFileError(
          `${where}: targets ${position + 1} needs an \`expected\` grade.`,
        );
      }
      return {
        expected: row.expected,
        // `check: false` n'est jamais écrit : c'est le défaut, et un document
        // qui le pose sur cent lignes enseigne un champ là où il ne sert pas.
        ...(row.check === true ? { check: true } : {}),
      };
    }),
  };
}

/** Les cibles, telles qu'elles repartent dans le document. */
function targetsDocument(targets: JudgeTarget[]): unknown[] {
  return targets.map((target) =>
    target.check ? { expected: target.expected, check: true } : { expected: target.expected },
  );
}

/** Retire la clôture Markdown, quand elle est venue avec le texte.
 *
 * Un agent rend son document dans un bloc de code, et le coller à la main en
 * emporte souvent les backticks. YAML les refuse en parlant de clés implicites
 * à la ligne 1 — un message juste, et illisible pour qui vient de coller.
 *
 * La ligne d'ouverture suffit à décider : elle ne peut pas être du YAML utile.
 * La fermeture est retirée si elle est là, et son absence n'empêche rien —
 * une sélection s'arrête parfois avant. */
function withoutFence(text: string): string {
  const lines = text.trim().split("\n");
  if (!/^```/.test(lines[0] ?? "")) return text;
  const end = lines[lines.length - 1].trim() === "```" ? -1 : undefined;
  return lines.slice(1, end).join("\n");
}

/** Le fichier, lu et validé, ou une erreur qui dit ce qui manque. */
export function readConfigFile(text: string): ImportedConfig {
  let raw: unknown;
  try {
    raw = parse(withoutFence(text));
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
    // Les cibles du PRINCIPAL, au premier niveau comme son critère et son
    // échelle. Celles des secondaires voyagent dans `judges`.
    ...readTargets(file.targets, "the principal judge"),
    ...(typeof file.sees_system_prompt === "boolean"
      ? { sees_system_prompt: file.sees_system_prompt }
      : {}),
    // Les juges secondaires, en plus du principal ci-dessus — voir
    // `readJudges`. Absent ou vide, c'est la forme ancienne : un seul juge.
    judges: readJudges(file.judges),
    turns: asGiven(file.turns, 1),
    repetitions: asGiven(file.repetitions, 1),
    models: {
      targets: Array.isArray(models.targets)
        ? models.targets.map((target) => asString(target))
        : [],
      adversary: asString(models.adversary) || null,
      judge: asString(models.judge),
      // Requis exactement quand un outil sert, interdit sinon — voir
      // `configProblem`. Même patron qu'`adversary` : une chaîne vide se lit
      // comme absente.
      world: asString(models.world) || null,
    },
    adversary_prompt: asString(file.adversary_prompt),
    // Ce que contient l'environnement, pour les outils qui portent des
    // `retrieval_rules`. Vide pour tous les documents écrits avant ce champ,
    // et pour tous ceux dont aucun outil n'est servi.
    world: asString(file.world),
    tools: readTools(file.tools),
    max_tool_calls_per_turn: asGiven(file.max_tool_calls_per_turn, 5),
    // Seule l'absence — undefined ou null — se lit comme l'interrupteur
    // allumé : un fichier écrit avant ce champ n'en porte pas, et ça doit
    // rester lisible. Une valeur présente est transmise telle quelle, sans la
    // réduire ici à un booléen : un `!== false` la réduirait déjà en écrasant
    // toute autre forme que le booléen `false` en `true`, y compris une
    // chaîne "false" mal entre guillemets — et `configProblem`, plus bas, ne
    // pourrait alors plus jamais la voir pour la refuser.
    check_eval_awareness:
      file.check_eval_awareness === undefined || file.check_eval_awareness === null
        ? true
        : (file.check_eval_awareness as boolean),
    average_output_tokens:
      typeof file.average_output_tokens === "number"
        ? file.average_output_tokens
        : undefined,
    // Aucune borne n'est inventée ici. `min` valait 1 par défaut, un chiffre
    // écrit nulle part : un fichier ne donnant que `max: 0.8` se voyait
    // reprocher une borne basse qu'il n'avait jamais écrite. Et un `max` mal
    // typé était réduit à `null`, c'est-à-dire silencieusement effacé.
    temperature: temperature
      ? {
          min: temperature.min as number,
          max: (temperature.max ?? null) as number | null,
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
    rubric: rubricDocument(config.rubric),
    ...(config.targets ? { targets: targetsDocument(config.targets) } : {}),
    ...(config.sees_system_prompt === false ? { sees_system_prompt: false } : {}),
    // Un bloc à soi, conditionné sur lui seul — jamais partagé avec celui d'un
    // autre champ. C'est exactement ce piège-là (une clé posée à l'intérieur du
    // bloc conditionnel d'une autre) qui a déjà fait perdre `max_tool_calls_per_turn`
    // en silence sur un run sans outils : ici, un run sans juge secondaire ne
    // doit rien pouvoir faire disparaître d'autre, et réciproquement.
    ...(config.judges && config.judges.length > 0
      ? {
          judges: config.judges.map((judge) => ({
            criterion: judge.criterion,
            rubric: rubricDocument(judge.rubric),
            ...(judge.model ? { model: judge.model } : {}),
            ...(judge.targets ? { targets: targetsDocument(judge.targets) } : {}),
            // Écrit seulement quand il diffère du défaut : une clé posée
            // partout enseignerait un réglage là où il n'y a rien à décider.
            ...(judge.sees_system_prompt === false
              ? { sees_system_prompt: false }
              : {}),
          })),
        }
      : {}),
    turns: config.turns,
    repetitions: config.repetitions,
    temperature: config.temperature ?? null,
    models: config.models,
    adversary_prompt: config.adversary_prompt,
    // Omis quand il est vide, comme les outils : un `world: ''` dans chaque
    // gabarit inviterait à le remplir sur des runs qui n'ont aucun outil servi.
    ...(config.world ? { world: config.world } : {}),
    // Toujours écrit, jamais omis : contrairement à `average_output_tokens`,
    // ce champ n'a pas d'état « absent » à préserver — un run qui ne l'a pas
    // encore écrit tourne quand même comme s'il valait vrai.
    check_eval_awareness: config.check_eval_awareness !== false,
    ...(config.tools && config.tools.length > 0
      ? {
          // Chaque outil n'écrit que la moitié de la paire de RÉPONSE qui le
          // décrit — `world_effect`, qui dit ce qu'il change, s'ajoute aux deux
          // formes sans en faire partie. Un
          // `result: ''` posé à côté de `retrieval_rules` se relit sans
          // dommage, mais donne à lire un outil qui serait les deux — et ce
          // document est ce qu'un agent édite pour repartir d'un run.
          tools: config.tools.map((tool) =>
            // `served(tool)`, jamais `tool.retrieval_rules` brut : un champ
            // blanc y est truthy, et écrirait ici la forme servie — perdant
            // `result` en route — pour un outil qui, `configProblem` mis à
            // part, n'est en réalité que fixe. Voir C4.
            ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              ...(served(tool)
                ? { retrieval_rules: tool.retrieval_rules }
                : { result: tool.result }),
              // L'effet, lui, s'écrit des deux côtés de cette exclusion : il
              // n'en fait pas partie. Omis quand il est vide, comme partout
              // ailleurs dans ce document — un champ vide donnerait à lire un
              // outil qui écrit alors qu'il ne touche à rien.
              ...(writesWorld(tool) ? { world_effect: tool.world_effect } : {}),
            }),
          ),
          max_tool_calls_per_turn: config.max_tool_calls_per_turn ?? 5,
        }
      : {}),
    // Omis plutôt qu'écrit `undefined` : un document relu ne doit pas gagner
    // une clé que l'original n'avait pas.
    ...(config.average_output_tokens === undefined
      ? {}
      : { average_output_tokens: config.average_output_tokens }),
    scenarios: config.scenarios.map((scenario) =>
      scenario.history && scenario.history.length > 0
        ? scenario
        : // Un `history: []` partout alourdirait le gabarit sans rien dire.
          {
            title: scenario.title,
            system_prompt: scenario.system_prompt,
            opening_message: scenario.opening_message,
            ...(scenario.note ? { note: scenario.note } : {}),
            ...(scenario.world ? { world: scenario.world } : {}),
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
