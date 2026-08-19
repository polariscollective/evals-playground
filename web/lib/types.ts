export type Verdict = "met" | "not_met" | "borderline";

export type RunStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled";

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

export interface SelectedScenario {
  scenario_id: string;
  title: string;
  system_prompt: string;
  opening_message: string;
  tests_for: string;
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

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_cache_read: number;
  input_tokens_cache_write: number;
  reasoning_tokens: number;
}

export interface EvalRunConfig {
  scenarios: EvalScenario[];
  criterion: string;
  turns: number;
  repetitions: number;
  models: EvalModels;
  adversary_prompt: string;
  temperature?: TemperatureSpec | null;
  label?: string | null;
  source?: ScenarioSource | null;
  /** Le commentaire écrit au lancement, en markdown. */
  notes?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  /** `content_filter` quand le fournisseur a bloqué la génération. */
  stop_reason: string | null;
}

export interface Conversation {
  conversation_id: string;
  repetition: number;
  scenario_index: number;
  target: string;
  temperature: number | null;
  messages: Message[];
  verdict: Verdict | null;
  justification: string;
}

export interface Tally {
  met: number;
  not_met: number;
  borderline: number;
}

export interface EvalRunRecord {
  run_id: string;
  created_at: string;
  label: string | null;
  status: RunStatus;
  config: EvalRunConfig;
  progress: { completed: number; total: number };
  error: string | null;
  log_path: string | null;
  /** Notes libres saisies depuis la page du run. */
  notes: string;
  /** Jetons réellement consommés, par modèle. Vide tant que le run n'a rien produit. */
  usage: Record<string, ModelUsage>;
  /** Coût réel en dollars, ou null si un modèle employé n'a pas de tarif connu. */
  cost_usd: number | null;
  /** Une entrée par scénario, alignée sur config.scenarios. */
  tallies: Record<string, Tally>[];
  conversations: Conversation[];
}

export interface CostEstimate {
  /** L'hypothèse de longueur de réponse qui produit `usd`. */
  response_tokens: number;
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
  unpriced_models: string[];
}

export interface JudgePromptPreview {
  system_message: string;
  user_message: string;
}
