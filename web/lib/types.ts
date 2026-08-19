export type Verdict = "met" | "not_met" | "borderline";

export type RunStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** Les deux phases partagent le même cycle de vie de run. */
export type EvalRunStatus = RunStatus;

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
  target: string;
  adversary?: string | null;
  judge: string;
}

export interface TemperatureSpec {
  min: number;
  max?: number | null;
}

export interface EvalRunConfig {
  scenario: EvalScenario;
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
  status: EvalRunStatus;
  config: EvalRunConfig;
  progress: { completed: number; total: number };
  error: string | null;
  log_path: string | null;
  tally: Tally;
  conversations: Conversation[];
}
