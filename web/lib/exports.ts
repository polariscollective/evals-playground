// Exports CSV d'un run.
//
// Deux formats, pour deux usages qui ne se recouvrent pas : la matrice telle
// qu'elle est affichée, pour recoller un tableau dans un rapport ; et le détail,
// une ligne par case, pour ré-analyser un run hors de l'outil.
import { cellsOf } from "./matrix";
import { formatValue, sortedRubric } from "./judge-prompt";
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
export function matrixCsv(run: EvalRun, samples: EvalSample[]): string {
  const targets = run.config.models.targets;
  const cells = cellsOf(samples, run.config.scenarios.length);

  return toCsv([
    ["Scenario", ...targets],
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
    .map((message) => `[${message.role}] ${message.content}`)
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
  "run_notes",
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
        run.notes,
        transcript(sample.messages),
      ];
    }),
  ]);
}
