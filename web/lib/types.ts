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

export type ToolParamType = "string" | "number" | "integer" | "boolean";

export interface ToolParam {
  name: string;
  type: ToolParamType;
  description: string;
  required: boolean;
}

/** Un outil offert au modèle évalué.
 *
 * Rien n'est exécuté : l'outil existe et rend `result`. Ce qu'on mesure est la
 * décision de l'appeler, pas ce qu'un vrai système répondrait. */
export interface ToolSpec {
  /** Contraint par les fournisseurs : `[a-zA-Z0-9_-]`, 64 caractères au plus. */
  name: string;
  /** Ce que le modèle lit pour décider. C'est là que vit la pression. */
  description: string;
  parameters: ToolParam[];
  /** Ce que l'outil renvoie, toujours la même chose : sans quoi deux
   *  répétitions ne mesureraient pas la même expérience. */
  result: string;
}

export interface SeededTurn {
  role: "user" | "assistant";
  content: string;
}

export interface EvalScenario {
  title: string;
  system_prompt: string;
  opening_message: string;
  /** Pourquoi ce scénario existe, à l'usage de qui relit la matrice.
   *
   * Ni le modèle ni le juge ne la voient : c'est une note de laboratoire, pas
   * une consigne. « Pourquoi cette ligne » est la question qu'on se pose devant
   * une matrice six mois plus tard, et le titre seul n'y répond pas. */
  note?: string;
  /** Un état de conversation posé d'avance, propre à ce scénario.
   *
   * Sert à mesurer ce qu'un modèle fait *depuis* un état sans avoir à l'y
   * amener : dérouler le préambule en vrais tours coûte des appels et n'aboutit
   * pas au même endroit à chaque répétition. Par scénario et non par run — deux
   * lignes de la même matrice peuvent partir d'états différents.
   *
   * Alterne user/assistant en commençant par l'utilisateur et en finissant par
   * l'assistant : le message d'ouverture est le tour utilisateur qui suit. */
  history?: SeededTurn[];
  /** Les outils offerts à ce scénario, par leur nom.
   *
   * Trois états : absent offre tous ceux du run, une liste offre ceux-là, une
   * liste vide n'en offre aucun. Sans le troisième, on ne pourrait pas comparer
   * une ligne avec outils à la même ligne sans. */
  tools?: string[] | null;
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
  /** La colonne portant l'historique posé, en JSON. Vide s'il n'y en a pas. */
  column_history?: string;
  /** La colonne disant quels outils le scénario reçoit. Vide s'il n'y en a pas. */
  column_tools?: string;
  /** La colonne portant la note de laboratoire du scénario. */
  column_note?: string;
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
  /** Les outils du run, définis une fois et offerts aux scénarios.
   *
   * Au niveau du run parce qu'un outil décrit un monde, pas une situation. */
  tools?: ToolSpec[];
  /** Combien d'appels d'affilée un modèle peut faire avant qu'on lui rende la
   *  main. Le bon nombre dépend de ce qu'on mesure : une tâche à trois étapes ne
   *  se juge pas avec un plafond de un. */
  max_tool_calls_per_turn?: number;
  /** Combien de jetons de sortie une réponse du modèle évalué consomme, en gros.
   *
   * Sert au devis et à rien d'autre : ce nombre ne change pas ce que le run
   * fait. Il compte **tout** ce que le modèle produit à chaque appel —
   * raisonnement compris, pas seulement la réponse qu'on lit. C'est l'unité
   * que les fournisseurs facturent, et un modèle qui réfléchit avant de
   * répondre dépense plusieurs fois sa réponse visible.
   *
   * Optionnel dans le type et obligatoire dans `configProblem` : les runs
   * enregistrés avant ce champ n'en ont pas et doivent rester lisibles. */
  average_output_tokens?: number;
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
  /** Facultative : la colonne portant l'historique posé, en JSON. */
  column_history?: string;
  /** Facultative : la colonne portant la note de laboratoire du scénario. */
  column_note?: string;
}

/** Ce qu'on ajoute à un run existant : une sous-matrice, et rien d'autre.
 *
 * Ni juge, ni échelle, ni critère : ce qui ne peut pas être envoyé ne peut pas
 * dériver, et deux lots jugés différemment ne seraient plus comparables — ce
 * qu'une matrice existe précisément pour permettre.
 *
 * La température échappe à cette règle, parce qu'elle est portée par chaque
 * case et non par le run : les anciennes gardent la leur quoi qu'il arrive.
 *
 * Le nombre de tours échappe aussi, mais justifié : on ne coupe jamais une
 * conversation déjà jouée, on ne peut que l'allonger. Si on l'approfondit, elle
 * est rejugée entière — un verdict sur quatre tours ne dit rien de la même
 * conversation à huit. Enfin, la profondeur du run reste la même pour toutes
 * ses cases : celle qu'on a demandée. Une case qui s'est arrêtée plus tôt l'a
 * fait parce qu'elle n'avait plus rien à donner ; la forcer au-delà n'apprendrait
 * rien, et la moyenne la compte en équilibre avec les autres. */
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
  /** Des outils à ajouter au décor du run.
   *
   * Ajouter est permis, redéfinir non : un outil qui reprendrait un nom
   * existant ferait relire les cases déjà jouées comme ayant eu celui-ci. */
  new_tools?: ToolSpec[];
  /** Les scénarios existants qui n'avaient nommé aucun outil — donc « tous
   *  ceux du run » — héritent-ils des nouveaux ?
   *
   * Ne change rien aux cases déjà jouées, qui sont faites : seulement ce que
   * verrait une ré-exécution de ces scénarios, en les recouvrant avec d'autres
   * modèles ou d'autres essais. `false` fige leur liste sur les outils qui
   * existaient, pour qu'ils revoient exactement ce qu'ils ont toujours vu. */
  new_tools_for_existing?: boolean;
  /** La profondeur voulue pour le run. Jamais inférieure à l'actuelle : une
   *  conversation déjà jouée ne se coupe pas. Absent laisse la profondeur
   *  telle quelle. */
  turns?: number;
  /** Les essais à continuer jusqu'à `turns`, choisis par la note que le juge
   *  leur a donnée : le serveur retrouve lui-même lesquels, puisque c'est lui
   *  qui a les notes.
   *
   * Un ensemble quelconque et non un rectangle : les essais d'une même case
   * n'ont pas tous la même note, et on approfondit ce qui a tenu en laissant
   * ce qui a déjà cédé — `"all"` pour tous les essais notés du run, une liste
   * de notes pour ne prendre que celles-là. Absent n'approfondit rien. */
  deepen?: "all" | number[];
}

export interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  /** Écrit par l'expérimentateur, pas produit par un modèle. */
  seeded?: boolean;
  /** Les outils que ce tour d'assistant a décidé d'appeler. */
  tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  /** Sur un tour `tool` : l'outil qui a « répondu ». */
  tool_name?: string | null;
  /** Sur un tour `tool` : l'appel auquel ce résultat répond. */
  tool_call_id?: string | null;
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
  /** Écrite après coup, distincte de `notes` qui est le préambule. Jamais
   *  portée par `config` : une duplication ne la reprend pas. */
  analysis: string;
  /** Publié : `/shared/<id>` répond hors session. Écrit par la seule route
   *  `/api/runs/<id>/publish`. */
  is_public: boolean;
  /** Écarté des listes et de la lecture publique. Rien n'est effacé. */
  deleted_at: string | null;
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
  /** Le brouillon dont ce run est sorti, s'il en vient d'un. Plusieurs runs
   *  peuvent désigner le même : relancer un brouillon est prévu. Sans clé
   *  étrangère — la provenance survit à la disparition du brouillon, et
   *  l'identifiant peut donc ne plus rien désigner. */
  draft_id: string | null;
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
  /** Combien de tours cette case a réellement joués.
   *
   * `null` tant qu'elle n'a pas tourné. Une case plus courte que la profondeur
   * du run n'est pas incomplète : elle s'est réglée là, et l'y pousser plus
   * loin n'aurait rien appris. */
  turns_done: number | null;
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
  /** Combien de fois chaque note a été donnée dans cette case.
   *
   * Une moyenne ne distingue pas un consensus d'un partage : 1,8 peut être
   * cinq essais serrés ou un 0 et quatre 2, et sur un scénario comportemental
   * c'est toute la différence entre « le modèle hésite » et « le modèle fait
   * deux choses opposées selon les fois ».
   *
   * Ne compte que ce qui entre dans la moyenne : un « sans objet » est une
   * réponse, pas une note, et vit dans `excluded`. */
  grades: Record<string, number>;
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

/** Un run soumis par un agent, sauvegardé sans être lancé.
 *
 * Le geste de lancer reste un clic humain : c'est toute la raison d'être de
 * cette table plutôt que d'un run créé directement. */
/** Ce que tout brouillon porte, quoi qu'il propose. */
interface DraftCommon {
  id: string;
  csv_text: string | null;
  created_by: string;
  created_at: string;
  /** `manual` : enregistré depuis le formulaire, possiblement incomplet — on y
   *  revient plus tard. `mcp` : soumis par un agent, donc valide au moment où
   *  il a été écrit. */
  origin: "manual" | "mcp";
  /** Jeté : sort de la liste, et son adresse ne répond plus. */
  deleted_at: string | null;
  /** Lancé : sort de la liste, mais son adresse reste ouverte — on peut vouloir
   *  relancer la même chose. */
  launched_at: string | null;
  /** Ce qu'il a produit, s'il a été lancé. Répond après coup à « d'où vient ce
   *  run ». */
  launched_run_id: string | null;
}

/** Un run à lancer. */
export interface RunDraft extends DraftCommon {
  kind: "run";
  config: EvalRunConfig;
  extends_run_id: null;
}

/** Une sous-matrice à ajouter à un run existant.
 *
 * `config` porte une `ExtendRequest` : c'est la même colonne en base, et
 * `kind` dit comment la lire. L'union discriminée fait le reste — lire une
 * `EvalRunConfig` sur un brouillon d'extension ne compile pas.
 *
 * Rien n'est appliqué au run tant qu'il n'est pas lancé, outils proposés
 * compris : un brouillon qu'on jette doit laisser le run intact. */
export interface ExtendDraft extends DraftCommon {
  kind: "extend";
  config: ExtendRequest;
  extends_run_id: string;
}

export type Draft = RunDraft | ExtendDraft;

/** Un run ouvert : sa configuration, ses cases, sa matrice. */
export interface RunDetail {
  run: EvalRun;
  samples: EvalSample[];
  progress: Progress;
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

/** Un tag, et la couleur qu'il gardera. */
export interface Tag {
  id: number;
  label: string;
  color: string;
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
