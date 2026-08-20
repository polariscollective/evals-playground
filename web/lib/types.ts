export type RunStatus = "pending" | "running" | "done" | "error" | "cancelled";
export type SampleStatus = "pending" | "running" | "done" | "error";

/** Un palier de l'échelle : la note, et ce qu'elle veut dire pour le juge. */
export interface RubricLevel {
  value: number;
  meaning: string;
}

export interface EvalScenario {
  title: string;
  system_prompt: string;
  opening_message: string;
}

export interface EvalModels {
  targets: string[];
  adversary?: string | null;
  judge: string;
}

export interface TemperatureSpec {
  min: number;
  max?: number | null;
}

export interface ScenarioSource {
  kind: "manual" | "csv";
  file_name: string;
  column_title: string;
  column_system_prompt: string;
  column_opening_message: string;
  skipped_rows: number;
}

/** Ce que l'utilisateur remplit, tel qu'il est stocké dans `eval_runs.config`. */
export interface EvalRunConfig {
  scenarios: EvalScenario[];
  /** Ce que le juge doit regarder. Ce sont les paliers qui portent le jugement. */
  criterion: string;
  /** L'échelle sur laquelle le juge note. Au moins deux paliers. */
  rubric: RubricLevel[];
  turns: number;
  repetitions: number;
  models: EvalModels;
  adversary_prompt: string;
  temperature?: TemperatureSpec | null;
  label?: string | null;
  source?: ScenarioSource | null;
  notes?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  /** `content_filter` quand le fournisseur a bloqué la génération. */
  stop_reason?: string | null;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_cache_read: number;
  input_tokens_cache_write: number;
  reasoning_tokens: number;
}

/** Une ligne d'`eval_runs`. */
export interface EvalRun {
  id: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
  user_email: string;
  label: string | null;
  status: RunStatus;
  error: string | null;
  config: EvalRunConfig;
  notes: string;
  total_samples: number;
  usage: Record<string, ModelUsage>;
  cost_usd: number | null;
  rejudged_at: string | null;
  execution: string | null;
}

/** Une ligne d'`eval_samples` : une case de la matrice. */
export interface EvalSample {
  id: string;
  run_id: string;
  scenario_index: number;
  scenario_title: string;
  target_model: string;
  repetition: number;
  status: SampleStatus;
  temperature: number | null;
  score: number | null;
  justification: string;
  messages: Message[];
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

/** Où en est un run, compté sur ses cases. */
export interface Progress {
  total: number;
  done: number;
  running: number;
  pending: number;
  errored: number;
}

/** Une case de la matrice : ce qu'un modèle a obtenu sur un scénario.
 *
 * `unjudged` et `errored` sont comptés séparément. Une case traitée sans note —
 * conversation bloquée, réponse hors échelle — n'est pas une panne, et les
 * confondre effacerait la différence entre « on ne sait pas » et « ça a
 * cassé ». */
export interface Cell {
  judged: number;
  unjudged: number;
  errored: number;
  pending: number;
  mean: number | null;
}

/** Un run dans la liste : de quoi trier et décider d'ouvrir. */
export interface RunSummary {
  run: EvalRun;
  progress: Progress;
  mean: number | null;
}

/** Un run ouvert : sa configuration, ses cases, sa matrice. */
export interface RunDetail {
  run: EvalRun;
  samples: EvalSample[];
  progress: Progress;
  cells: Record<string, Cell>[];
  source_csv_available: boolean;
}

export interface ModelOption {
  id: string;
  label: string;
  /** Prix en dollars par million de jetons, ou null si le modèle n'est pas tarifé. */
  input_per_mtok: number | null;
  output_per_mtok: number | null;
}

export interface ProviderInfo {
  id: string;
  label: string;
  env_vars: string[];
  key_present: boolean;
  models: ModelOption[];
}

/** Ce qu'un modèle coûte dans un run, et sur quelle hypothèse. */
export interface ModelCost {
  model: string;
  input_tokens: number;
  output_tokens: number;
  response_tokens: number;
  /** null si le modèle n'a pas de tarif connu. */
  usd: number | null;
}

export interface CostEstimate {
  /** La longueur imposée à tous les modèles, ou null si chacun prend la sienne. */
  response_tokens: number | null;
  usd: number;
  eur: number;
  min_usd: number;
  max_usd: number;
  min_eur: number;
  max_eur: number;
  conversations: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  /** Le détail, du plus cher au moins cher. C'est lui qui explique un total. */
  per_model: ModelCost[];
  unpriced_models: string[];
}

export interface JudgePromptPreview {
  system_message: string;
  user_message: string;
}

/** Ce qu'on demande à une passe de juge rejouée. */
export interface RejudgeRequest {
  criterion: string;
  rubric: RubricLevel[];
  judge: string;
}
