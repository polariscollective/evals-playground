/** `triggered` : le job a été demandé, le conteneur n'a pas encore écrit. */
export type RunStatus =
  | "triggered"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** Pas de `triggered` ici : une case n'est jamais déclenchée individuellement,
 *  elles le sont toutes d'un coup avec le run. */
export type SampleStatus =
  | "pending"
  | "running"
  | "done"
  | "error"
  | "cancelled";

/** Un palier de l'échelle : la note, et ce qu'elle veut dire pour le juge. */
export interface RubricLevel {
  value: number;
  meaning: string;
  /** Hors moyenne : le juge a tranché, mais la note n'a pas de sens sur
   *  l'échelle — « la question ne s'appliquait pas ». La compter tirerait la
   *  case vers le bas pour une raison étrangère à ce qu'on mesure. */
  excluded?: boolean;
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

/** Les colonnes d'un CSV qu'un fichier de configuration annonce sans le porter.
 *
 * Un agent écrit la configuration ; le CSV des scénarios, lui, reste un fichier
 * à part qu'on téléverse ensuite. Nommer les colonnes ici évite de les redeviner
 * — et une devinette se trompe dès qu'un fichier nomme les siennes autrement. */
export interface ExpectedCsv {
  column_title: string;
  column_system_prompt: string;
  column_opening_message: string;
}

/** Ce qu'on ajoute à un run existant : une sous-matrice, et rien d'autre.
 *
 * Ni juge, ni échelle, ni nombre de tours : ce qui ne peut pas être envoyé ne
 * peut pas dériver, et deux lots jugés différemment ne seraient plus
 * comparables — ce qu'une matrice existe précisément pour permettre.
 *
 * La température échappe à cette règle, parce qu'elle est portée par chaque
 * case et non par le run : les anciennes gardent la leur quoi qu'il arrive. */
export interface ExtendRequest {
  /** Scénarios déjà présents à re-couvrir, par leur index. */
  scenario_indices: number[];
  /** Scénarios nouveaux, ajoutés à la suite de ceux du run. */
  new_scenarios: EvalScenario[];
  /** Modèles à couvrir — déjà évalués ou non, la distinction se fait ici. */
  targets: string[];
  /** Combien de répétitions ajouter à chaque couple retenu. */
  repetitions: number;
  temperature?: TemperatureSpec | null;
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
  /** Où le job a tourné : sur une machine de développement, ou sur Cloud Run. */
  origin: "local" | "cloud-run";
  /** Le devis calculé au lancement, à comparer à `cost_usd`. null sur les runs
   *  antérieurs à son enregistrement. */
  estimate: CostEstimate | null;
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
  /** Jetons consommés par cette case, par modèle. */
  usage: Record<string, ModelUsage>;
  /** Ce que cette case a coûté, ou null si un modèle employé n'a pas de tarif. */
  cost_usd: number | null;
}

/** Où en est un run, compté sur ses cases. */
export interface Progress {
  total: number;
  done: number;
  running: number;
  pending: number;
  errored: number;
  cancelled: number;
}

/** Une case de la matrice : ce qu'un modèle a obtenu sur un scénario.
 *
 * Quatre façons de ne pas avoir de note, et elles ne se confondent pas : une
 * case traitée sans note (conversation bloquée, réponse hors échelle), une case
 * en panne, une case jamais commencée parce qu'on a arrêté le run, et une case
 * encore à faire. Les mélanger effacerait la différence entre « on ne sait
 * pas », « ça a cassé » et « on a décidé de ne pas le faire ». */
export interface Cell {
  judged: number;
  unjudged: number;
  errored: number;
  /** Jamais commencée : le run a été arrêté avant d'y arriver. */
  cancelled: number;
  /** Notée « sans objet » : le juge a répondu, mais hors moyenne. */
  excluded: number;
  pending: number;
  mean: number | null;
  /** Somme de ce qu'ont coûté les cases de cette case de matrice. */
  cost_usd: number;
}

/** Un run dans la liste : de quoi trier et décider d'ouvrir. */
export interface RunSummary {
  run: EvalRun;
  progress: Progress;
  mean: number | null;
  /** Combien d'essais par case : le moins, le plus.
   *
   * Deux chiffres et non un seul, parce qu'un run qu'on a complété n'avance pas
   * au même rythme partout. `config.repetitions` ne dit plus que ce qui avait
   * été demandé au dernier lot. */
  repetitions: [number, number];
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
