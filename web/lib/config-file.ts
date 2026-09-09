// Reading a run described in a file, JSON or YAML.
//
// The idea is that an agent can write a run's configuration — scenarios, scale,
// models — and that it is laid down as it stands in the form. What is asked for
// here is exactly the shape stored in `eval_runs.config`: one shape to learn,
// and an exported run reimports without translation.
//
// One parser for both formats: JSON 1.2 is a subset of YAML, and `parse`
// therefore swallows both. It lives on the server side to stay out of the
// bundle sent to the browser, and so that the validation stays the one that has
// authority.
import { parse, stringify } from "yaml";
import { served, writesWorld } from "./tools.ts";
import { configProblem } from "./validate.ts";
import type {
  EvalRunConfig,
  EvalScenario,
  ExpectedCsv,
  JudgeSpec,
  RubricLevel,
  SeededTurn,
  ToolParamType,
  ToolSpec,
} from "./types";

export interface ImportedConfig {
  /** The scenarios are empty when the file announces a CSV. */
  config: EvalRunConfig;
  csv: ExpectedCsv | null;
}

/** Raised as it stands to the user: its message must read. */
export class ConfigFileError extends Error {}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Absent, the field takes its default; present, it passes as it stands — even
 *  badly typed — so that `configProblem` can refuse it.
 *
 *  Coercing here made the mistake invisible: `turns: "4"`, a 4 put in quotes as
 *  YAML invites, fell back on the default 1 and the document passed, since at a
 *  single turn the adversary is no longer required. One received a one-turn run
 *  believing one had ordered four. Same reasoning as for `check_eval_awareness`
 *  further down: this file reads, it does not judge. */
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
      // The seeded history, this scenario's own. Absent most of the time, and
      // absent from the written file when it is: an empty array everywhere
      // would make noise in a template.
    note: asString(row.note),
      // What this row changes about the run's world. Added to its own as a
      // named and prioritised block, never melted into it: that is what makes a
      // negation safe rather than a contradiction to untangle.
    world: asString(row.world),
    history: readHistory(row.history, position),
      // Three states to preserve: absent offers all the run's tools, a list
      // offers those, `none` offers none. Confusing them would make the
      // comparison "the same row, with and without tools" disappear.
    tools: readScenarioTools(row.tools, position),
  };
}

function readScenarioTools(value: unknown, position: number): string[] | null {
  if (value === undefined || value === null) return null;
    // `tools: none` is the readable way of saying "none" in a file written by
    // hand. YAML would return `~` or `null`, which means "absent" — hence
    // "all" — and the gap between the two is exactly what counts here.
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

/** The file's "scenarios" part: a list, or the announcement of a CSV. */
function readScenarios(value: unknown): {
  scenarios: EvalScenario[];
  csv: ExpectedCsv | null;
} {
  // `scenarios: csv` — the shortest form, when the columns carry the names one
  // will guess anyway at upload time.
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
        // The discriminant of the two forms. Filled in, the tool is served from
        // the world; empty, it returns `result` with no model called at all.
        // `configProblem` refuses both together.
      retrieval_rules: asString(tool.retrieval_rules),
        // The second discriminant, independent of the first: what calling it
        // CHANGES about the world. Filled in, the call enters the
        // conversation's log and the reads that follow take it into account. A
        // fixed tool can carry it — that is even the common form.
      world_effect: asString(tool.world_effect),
    };
  });
}

/** `where` locates the error: `"rubric"` for the principal's scale, at the top
 *  level; `"judge 2: rubric"` for a secondary judge's — see `readJudges`. Both
 *  read the same shape, hence the same code. */
function readRubric(value: unknown, where = "rubric"): RubricLevel[] {
  // Two different faults, two messages: "missing" for an absent scale, and what
  // is expected for a scale that is present but malformed — a table of levels,
  // or another key name, both used to say "missing", which sent people looking
  // in the wrong place.
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
        // A "not applicable" level: the judge may choose it, the mean ignores
        // it.
      excluded: row.excluded === true,
    };
  });
}

/** The shape of a scale as it is written in the file: `excluded` omitted when
 *  it is `false`, the reader's default — writing it everywhere would be noise
 *  and would teach a field where it serves no purpose. Shared between the
 *  principal's scale and each secondary judge's: the two must be written the
 *  same way, and one single place guarantees it. */
function rubricDocument(rubric: RubricLevel[]): unknown[] {
  return rubric.map((level) =>
    level.excluded
      ? { value: level.value, meaning: level.meaning, excluded: true }
      : { value: level.value, meaning: level.meaning },
  );
}

/** The run's secondary judges, on top of the principal — see `JudgeSpec` in
 *  `types.ts`.
 *
 * Absent or empty: the old shape, that of every file already written —
 * `criterion`/`rubric` at the top level stay the only judge, and describe the
 * principal. Each entry here adds one more, always ordinary: `JudgeSpec`
 * carries neither a system type nor a mark of principal, so no entry can claim
 * either — a key such as `system_type` or `is_principal`, slipped in here by
 * mistake or by an agent that has not understood the format, is simply never
 * read, like any other unknown key in this file.
 *
 * The semantic validation (a non-empty criterion, a scale that holds, two
 * counted levels) is left to `configProblem`, called at the end of
 * `readConfigFile` — exactly as for the principal and for the tools: what is
 * read here only gives a shape, never a judgement. */
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
      // Like `check_eval_awareness`: a type that is not the right one is not
      // guessed. `asString` would silently erase a number or a boolean slipped
      // in here into an empty string, and the judge would run with the run's
      // default model without anyone having asked for it.
    if (model !== undefined && model !== null && typeof model !== "string") {
      throw new ConfigFileError(`judge ${position + 1}: model must be text.`);
    }
    return {
      criterion: asString(row.criterion),
      rubric: readRubric(row.rubric, `judge ${position + 1}: rubric`),
      ...(typeof model === "string" ? { model } : {}),
    };
  });
}

/** Removes the Markdown fence, when it came with the text.
 *
 * An agent returns its document in a code block, and pasting it by hand often
 * carries the backticks along. YAML refuses them while talking about implicit
 * keys at line 1 — a fair message, and unreadable for whoever has just pasted.
 *
 * The opening line is enough to decide: it cannot be useful YAML. The closing
 * one is removed if it is there, and its absence prevents nothing — a selection
 * sometimes stops short. */
function withoutFence(text: string): string {
  const lines = text.trim().split("\n");
  if (!/^```/.test(lines[0] ?? "")) return text;
  const end = lines[lines.length - 1].trim() === "```" ? -1 : undefined;
  return lines.slice(1, end).join("\n");
}

/** The file, read and validated, or an error that says what is missing. */
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
      // The secondary judges, on top of the principal above — see `readJudges`.
      // Absent or empty, this is the old shape: a single judge.
    judges: readJudges(file.judges),
    turns: asGiven(file.turns, 1),
    repetitions: asGiven(file.repetitions, 1),
    models: {
      targets: Array.isArray(models.targets)
        ? models.targets.map((target) => asString(target))
        : [],
      adversary: asString(models.adversary) || null,
      judge: asString(models.judge),
        // Required exactly when a tool serves, forbidden otherwise — see
        // `configProblem`. Same pattern as `adversary`: an empty string reads as
        // absent.
      world: asString(models.world) || null,
    },
    adversary_prompt: asString(file.adversary_prompt),
      // What the environment holds, for the tools carrying `retrieval_rules`.
      // Empty for every document written before this field, and for every one
      // whose tools are all unserved.
    world: asString(file.world),
    tools: readTools(file.tools),
    max_tool_calls_per_turn: asGiven(file.max_tool_calls_per_turn, 5),
      // Only the absence — undefined or null — reads as the switch turned on: a
      // file written before this field does not carry it, and that must stay
      // legible. A present value is passed through as it stands, without
      // reducing it to a boolean here: a `!== false` would already reduce it by
      // crushing any form other than the boolean `false` into `true`, including
      // a string "false" wrongly in quotes — and `configProblem`, further down,
      // could then never see it to refuse it.
    check_eval_awareness:
      file.check_eval_awareness === undefined || file.check_eval_awareness === null
        ? true
        : (file.check_eval_awareness as boolean),
    average_output_tokens:
      typeof file.average_output_tokens === "number"
        ? file.average_output_tokens
        : undefined,
      // No bound is invented here. `min` used to default to 1, a figure written
      // nowhere: a file giving only `max: 0.8` found itself reproached for a
      // lower bound it had never written. And a badly typed `max` was reduced to
      // `null`, that is, silently erased.
    temperature: temperature
      ? {
          min: temperature.min as number,
          max: (temperature.max ?? null) as number | null,
        }
      : null,
    label: asString(file.label) || null,
    notes: asString(file.notes),
  };

  // The validation is the one used at launch, with no exception: a file that
  // passed here only to fail at launch time would do nobody a service. The dummy
  // scenario stands in for those the CSV will bring, and is never kept.
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

/** The reverse path: a configuration written into a file one can lay down
 *  again.
 *
 * In YAML and not in JSON, because that is what the prompt asks the agent for:
 * two formats for the two directions of the same conversion would be one more
 * oddity to explain. The writing goes through the server for the same reason as
 * the reading — the parser stays out of the browser bundle.
 *
 * The scenarios are always written, including when they come from a CSV. The
 * `from: csv` form exists so that an agent can announce a file it does not
 * have; using it here would produce a file that does not stand on its own, and
 * that would not even say which CSV it is talking about. The file may be long —
 * it is an export, not a template, and the template is elsewhere.
 *
 * The provenance survives as a comment: it is not read back, but it answers
 * "where do these thirty scenarios come from" six months later. */
export function writeConfigFile(config: EvalRunConfig): string {
  const source = config.source;
  // The keys in the order the prompt presents them, and not the object's: a
  // template read from top to bottom must begin with what identifies the run,
  // and end with the scenarios, which are the long part.
  const document = {
    label: config.label ?? "",
    notes: config.notes ?? "",
    criterion: config.criterion,
      // `excluded: false` on every level would be noise: it is the reader's
      // default, and a file that writes it everywhere teaches a field where it
      // serves no purpose.
    rubric: rubricDocument(config.rubric),
      // A block of its own, conditioned on itself alone — never shared with
      // another field's. It is exactly that trap (a key laid inside another's
      // conditional block) which has already lost `max_tool_calls_per_turn` in
      // silence on a run with no tools: here, a run with no secondary judge must
      // not be able to make anything else disappear, and vice versa.
    ...(config.judges && config.judges.length > 0
      ? {
          judges: config.judges.map((judge) => ({
            criterion: judge.criterion,
            rubric: rubricDocument(judge.rubric),
            ...(judge.model ? { model: judge.model } : {}),
          })),
        }
      : {}),
    turns: config.turns,
    repetitions: config.repetitions,
    temperature: config.temperature ?? null,
    models: config.models,
    adversary_prompt: config.adversary_prompt,
      // Omitted when it is empty, like the tools: a `world: ''` in every
      // template would invite filling it in on runs that have no served tool.
    ...(config.world ? { world: config.world } : {}),
      // Always written, never omitted: unlike `average_output_tokens`, this
      // field has no "absent" state to preserve — a run that has not written it
      // yet runs all the same as if it were true.
    check_eval_awareness: config.check_eval_awareness !== false,
    ...(config.tools && config.tools.length > 0
      ? {
            // Each tool writes only the half of the ANSWER pair that describes
            // it — `world_effect`, which says what it changes, adds itself to
            // both forms without being part of either. A `result: ''` laid
            // beside `retrieval_rules` reads back without harm, but gives a tool
            // to read that would be both — and this document is what an agent
            // edits to start again from a run.
          tools: config.tools.map((tool) =>
              // `served(tool)`, never raw `tool.retrieval_rules`: a blank field
              // is truthy there, and would write the served form here — losing
              // `result` on the way — for a tool which, `configProblem` aside,
              // is really only fixed. See C4.
            ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
              ...(served(tool)
                ? { retrieval_rules: tool.retrieval_rules }
                : { result: tool.result }),
                // The effect, for its part, is written on both sides of that
                // exclusion: it is not part of it. Omitted when it is empty,
                // like everywhere else in this document — an empty field would
                // give a tool to read that writes when it touches nothing.
              ...(writesWorld(tool) ? { world_effect: tool.world_effect } : {}),
            }),
          ),
          max_tool_calls_per_turn: config.max_tool_calls_per_turn ?? 5,
        }
      : {}),
      // Omitted rather than written `undefined`: a document read back must not
      // gain a key the original did not have.
    ...(config.average_output_tokens === undefined
      ? {}
      : { average_output_tokens: config.average_output_tokens }),
    scenarios: config.scenarios.map((scenario) =>
      scenario.history && scenario.history.length > 0
        ? scenario
          : // A `history: []` everywhere would weigh the template down for
            // nothing.
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

  const header = ["# evals-playground — load this file back with \"Load a config file\"."];
  if (source?.kind === "csv") {
    header.push(
      `# The ${config.scenarios.length} scenarios below were read from` +
        ` ${source.file_name || "a CSV"}` +
        (source.column_title
          ? `, columns ${source.column_title} / ${source.column_system_prompt}` +
            ` / ${source.column_opening_message}.`
          : "."),
    );
  }

  return (
    header.join("\n") +
    "\n" +
    // Without `lineWidth: 0`, a long instruction would be folded over several
    // lines: read back it would be identical, but unreadable for whoever edits
    // it.
    stringify(document, { lineWidth: 0 })
  );
}
