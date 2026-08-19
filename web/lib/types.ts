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

export interface EvalRunConfig {
  scenarios: EvalScenario[];
  criterion: string;
  turns: number;
  repetitions: number;
  models: EvalModels;
  adversary_prompt: string;
  temperature?: TemperatureSpec | null;
  label?: string | null;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
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
  /** Une entrée par scénario, alignée sur config.scenarios. */
  tallies: Record<string, Tally>[];
  conversations: Conversation[];
}

export interface CostEstimate {
  min_usd: number;
  max_usd: number;
  min_eur: number;
  max_eur: number;
  conversations: number;
  model_calls: number;
  unpriced_models: string[];
}

export interface JudgePromptPreview {
  system_message: string;
  user_message: string;
}
