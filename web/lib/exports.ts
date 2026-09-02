// Exports CSV d'un run.
//
// Deux formats, pour deux usages qui ne se recouvrent pas : la matrice telle
// qu'elle est affichée, pour recoller un tableau dans un rapport ; et le détail,
// une ligne par case, pour ré-analyser un run hors de l'outil.
import { cellsOf } from "./matrix";
import { PLAIN_VIEW, describeView, type MatrixView } from "./view";
import { formatValue, sortedRubric } from "./judge-prompt";
import { toolsFor } from "./tools";
import type { EvalRun, EvalSample, Message } from "./types";

function cell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(cell).join(",")).join("\n");
}

/** La matrice telle qu'affichée : une ligne par scénario, une colonne par modèle.
 *
 * Chaque case porte la moyenne des notes obtenues. Une case dont rien n'a pu
 * être noté reste vide plutôt que de valoir zéro : la distinction est la même
 * qu'à l'écran, et c'est la plus facile à perdre en passant par un tableur. */
export function matrixCsv(
  run: EvalRun,
  samples: EvalSample[],
  view: MatrixView = PLAIN_VIEW,
): string {
  const targets = run.config.models.targets;
  const cells = cellsOf(
    samples,
    run.config.scenarios.length,
    run.config.rubric,
    view,
  );

  return toCsv([
    // L'en-tête dit ce que contiennent les cases. Un chiffre qui n'est plus la
    // moyenne des notes doit se présenter, surtout une fois recopié dans un
    // tableur où plus rien ne le rappelle.
    [`Scenario — each cell is ${describeView(view, run.config.rubric)}`, ...targets],
    ...run.config.scenarios.map((scenario, index) => [
      scenario.title,
      ...targets.map((target) => {
        const mean = cells[index]?.[target]?.mean;
        return mean == null ? "" : mean.toFixed(2);
      }),
    ]),
  ]);
}

function transcript(messages: Message[]): string {
  return messages
    .map(
      (message) =>
        // Le marquage suit le transcript jusque dans l'export : une analyse
        // faite hors de l'outil, sur ce fichier, doit pouvoir séparer ce que le
        // modèle a produit de ce qu'on lui a posé.
        `[${message.role}${message.seeded ? ", given as context" : ""}${
          message.tool_name ? ` ${message.tool_name}` : ""
        }] ${message.content}${(message.tool_calls ?? [])
          .map((call) => `\ncalls ${call.name}(${JSON.stringify(call.arguments)})`)
          .join("")}`,
    )
    .join("\n\n");
}

/** L'échelle du run sur une ligne, de la note la plus basse à la plus haute. */
function rubricLine(run: EvalRun): string {
  return sortedRubric(run.config.rubric)
    .map((level) => `${formatValue(level.value)} = ${level.meaning}`)
    .join(" | ");
}

const DETAIL_COLUMNS = [
  "run_id",
  "run_name",
  "created_at",
  "scenario_index",
  "scenario_title",
  "system_prompt",
  "opening_message",
  "target_model",
  "repetition",
  "status",
  "temperature",
  "score",
  "justification",
  "cost_usd",
  "error",
  "turns",
  "message_count",
  "tools_available",
  "criterion",
  "rubric",
  "adversary_model",
  "adversary_prompt",
  "judge_model",
  "models_configured",
  "repetitions_configured",
  "temperature_min",
  "temperature_max",
  "scenario_source",
  "source_file",
  "transcript",
];

/** Une ligne par case, avec tous les paramètres d'entrée du run.
 *
 * Volontairement redondant : chaque ligne répète le scénario, la question et la
 * configuration. Un fichier où chaque ligne se suffit à elle-même survit au
 * tri, au filtre et au copier-coller partiel, ce qu'une table normalisée ne
 * fait pas. */
export function detailsCsv(run: EvalRun, samples: EvalSample[]): string {
  const config = run.config;
  const temperature = config.temperature;
  const source = config.source;
  const rubric = rubricLine(run);

  return toCsv([
    DETAIL_COLUMNS,
    ...samples.map((sample) => {
      const scenario = config.scenarios[sample.scenario_index];
      return [
        run.id,
        run.label ?? "",
        run.created_at,
        String(sample.scenario_index),
        scenario?.title ?? sample.scenario_title,
        scenario?.system_prompt ?? "",
        scenario?.opening_message ?? "",
        sample.target_model,
        String(sample.repetition),
        sample.status,
        sample.temperature == null ? "" : String(sample.temperature),
        sample.score == null ? "" : String(sample.score),
        sample.justification,
        sample.cost_usd == null ? "" : String(sample.cost_usd),
        sample.error ?? "",
        String(config.turns),
        String(sample.messages.length),
        // Quels outils cette case avait réellement sous la main. Un scénario
        // peut n'en recevoir aucun quand les autres les ont tous, et c'est
        // souvent la comparaison qu'on cherche : la colonne le dit ligne à
        // ligne plutôt que de laisser déduire.
        scenario
          ? toolsFor(config, scenario)
              .map((tool) => tool.name)
              .join(" ") || "none"
          : "",
        config.criterion,
        // L'échelle accompagne la question : une note lue seule, sans savoir ce
        // que valait « 2 », ne se relit pas.
        rubric,
        config.models.adversary ?? "",
        config.adversary_prompt,
        config.models.judge,
        // La liste complète, et pas seulement le modèle de cette ligne : un
        // modèle qui n'aurait produit aucune conversation disparaîtrait sinon
        // de l'export, et avec lui la trace qu'on avait voulu l'évaluer.
        config.models.targets.join(" "),
        String(config.repetitions),
        temperature ? String(temperature.min) : "",
        temperature?.max == null ? "" : String(temperature.max),
        source?.kind ?? "manual",
        source?.file_name ?? "",
        transcript(sample.messages),
      ];
    }),
  ]);
}

/** Ce qui vaut pour tout le run, dans un fichier qui se lit.
 *
 * Les notes et les outils ne sont pas des données de case : les répéter sur
 * chaque ligne d'un CSV les rendait illisibles — une description d'outil de
 * trois phrases dans une cellule de tableur n'est lue par personne. Ici elles
 * ont la place de se lire, et le CSV garde ce qui varie d'une case à l'autre.
 *
 * En Markdown parce que ce fichier est fait pour être lu, par un humain ou par
 * un agent à qui on donne le dossier entier. */
export function runMarkdown(run: EvalRun, samples: EvalSample[]): string {
  const config = run.config;
  const lines: string[] = [];

  lines.push(`# ${run.label ?? "Evaluation run"}`, "");
  lines.push(`- **Run** \`${run.id}\``);
  lines.push(`- **Launched** ${run.created_at} by ${run.user_email}`);
  lines.push(
    `- **Shape** ${config.scenarios.length} scenarios × ` +
      `${config.models.targets.length} models × ${config.repetitions} repetitions` +
      ` · ${config.turns} turn${config.turns > 1 ? "s" : ""}`,
  );
  lines.push(`- **Status** ${run.status}`);
  if (run.cost_usd !== null) lines.push(`- **Cost** $${run.cost_usd}`);
  lines.push("");

  lines.push("## Notes", "");
  lines.push(run.notes.trim() || "_None._", "");

  lines.push("## What the judge was asked", "");
  lines.push(`**Judge** \`${config.models.judge}\``, "");
  lines.push("**Criterion**", "", config.criterion.trim(), "");
  lines.push("**Scale**", "");
  for (const level of sortedRubric(config.rubric)) {
    lines.push(
      `- \`${formatValue(level.value)}\` — ${level.meaning}` +
        (level.excluded ? " _(left out of the average)_" : ""),
    );
  }
  lines.push("");

  lines.push("## Models evaluated", "");
  for (const target of config.models.targets) lines.push(`- \`${target}\``);
  lines.push("");

  if (config.turns > 1) {
    lines.push("## The adversary", "");
    lines.push(`**Model** \`${config.models.adversary ?? "—"}\``, "");
    lines.push("**Prompt**", "", config.adversary_prompt.trim() || "_None._", "");
  }

  // Les outils tels qu'ils ont été présentés au modèle : nom, description et
  // arguments, mot pour mot. C'est ce qui permet de relire une décision
  // d'appel — sans la description, on ne sait pas ce que le modèle lisait.
  const tools = config.tools ?? [];
  if (tools.length > 0) {
    lines.push("## Tools offered", "");
    lines.push(
      "_Nothing was executed. Each call returned the fixed result below,",
      "the same on every repetition._",
      "",
    );
    for (const tool of tools) {
      lines.push(`### \`${tool.name}\``, "");
      lines.push("**Description given to the model**", "", tool.description, "");
      if (tool.parameters.length > 0) {
        lines.push("| parameter | type | required | description |");
        lines.push("|---|---|---|---|");
        for (const param of tool.parameters) {
          lines.push(
            `| \`${param.name}\` | ${param.type} | ${param.required ? "yes" : "no"} |` +
              ` ${param.description} |`,
          );
        }
        lines.push("");
      }
      lines.push("**Result returned on every call**", "", tool.result || "_Empty._", "");

      // Où l'outil a servi : un outil défini mais offert à aucun scénario est
      // une erreur silencieuse qu'on ne verrait nulle part ailleurs.
      const offert = config.scenarios
        .filter((scenario) =>
          toolsFor(config, scenario).some((entry) => entry.name === tool.name),
        )
        .map((scenario) => scenario.title);
      lines.push(
        offert.length === config.scenarios.length
          ? "_Offered to every scenario._"
          : offert.length === 0
            ? "_Offered to no scenario._"
            : `_Offered to:_ ${offert.join(", ")}`,
        "",
      );

      const appels = samples.reduce(
        (total, sample) =>
          total +
          sample.messages.filter((message) =>
            (message.tool_calls ?? []).some((call) => call.name === tool.name),
          ).length,
        0,
      );
      lines.push(`_Called ${appels} time${appels === 1 ? "" : "s"} across the run._`, "");
    }
  }

  lines.push("## Scenarios", "");
  for (const [index, scenario] of config.scenarios.entries()) {
    const offerts = toolsFor(config, scenario).map((tool) => tool.name);
    lines.push(`### ${index}. ${scenario.title}`, "");
    if (tools.length > 0) {
      lines.push(
        `**Tools available** ${offerts.length === 0 ? "none" : offerts.map((n) => `\`${n}\``).join(", ")}`,
        "",
      );
    }
    lines.push("**System prompt**", "", scenario.system_prompt.trim(), "");
    if (scenario.history && scenario.history.length > 0) {
      lines.push(
        "**Prior history** _(written by the experimenter, not produced by the model)_",
        "",
      );
      for (const turn of scenario.history) {
        lines.push(`- **${turn.role}** — ${turn.content}`);
      }
      lines.push("");
    }
    lines.push("**Opening message**", "", scenario.opening_message.trim(), "");
  }

  return lines.join("\n");
}
