// La validation de ce qu'un client envoie, avant que ça n'entre en base ou ne
// parte dans un job.
//
// Ce que pydantic faisait côté Python. Rien de ce qui arrive du navigateur
// n'est cru : une échelle à un seul palier, un scénario vide ou un multitours
// sans adversaire produiraient un run qui ne mesure rien, et le job n'aurait
// aucun moyen de s'en rendre compte.
import type {
  EvalRunConfig,
  ExtendRequest,
  RejudgeRequest,
  RubricLevel,
  SeededTurn,
  ToolSpec,
} from "./types";

const MIN_TURNS = 1;
// Exportée : le panneau d'extension la dupliquait faute de mieux (tâche 6),
// et l'outil MCP en a besoin pour borner `turns` sans la recopier à son tour.
export const MAX_TURNS = 100;

function isFilled(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Ce qui cloche dans une échelle, ou null si elle tient. */
export function rubricProblem(rubric: unknown): string | null {
  if (!Array.isArray(rubric) || rubric.length < 2) {
    // Avec un seul palier il n'y a pas de choix à faire, donc rien à mesurer.
    return "rubric must have at least two grades";
  }
  const values: number[] = [];
  for (const level of rubric as RubricLevel[]) {
    if (typeof level?.value !== "number" || !Number.isFinite(level.value)) {
      return "every grade needs a numeric value";
    }
    if (!isFilled(level?.meaning)) {
      // Une note sans son sens ne se relit pas, et le juge ne saurait pas quand
      // la choisir.
      return "every grade needs a description";
    }
    values.push(level.value);
  }
  if (new Set(values).size !== values.length) {
    // Le juge choisit une valeur, et c'est par elle qu'on retrouve le sens
    // qu'on lui avait donné.
    return "two grades cannot share the same value";
  }
  // Un « sans objet » ne mesure rien : une échelle qui n'aurait que lui et un
  // seul vrai palier ne laisserait aucun choix à faire.
  const comptes = (rubric as RubricLevel[]).filter((level) => !level.excluded);
  if (comptes.length < 2) {
    return "at least two grades must count towards the average";
  }
  return null;
}

/** Les fournisseurs n'acceptent pas d'autre forme de nom. */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

const TOOL_PARAM_TYPES = ["string", "number", "integer", "boolean"];

/** Ce qui cloche dans les outils d'un run, ou null.
 *
 * Le nom est vérifié ici parce que l'erreur, sinon, tombe au premier appel
 * facturé et sous une forme illisible : les fournisseurs refusent la requête
 * entière sans dire quel outil est en cause. */
export function toolsProblem(tools: unknown): string | null {
  if (tools === undefined || tools === null) return null;
  if (!Array.isArray(tools)) return "tools must be a list";

  const seen = new Set<string>();
  for (const tool of tools as ToolSpec[]) {
    if (!isFilled(tool?.name)) return "every tool needs a name";
    if (!TOOL_NAME.test(tool.name)) {
      return `tool "${tool.name}": a name may only use letters, digits, - and _, and at most 64 of them`;
    }
    if (seen.has(tool.name)) return `two tools are both named "${tool.name}"`;
    seen.add(tool.name);

    if (!isFilled(tool.description)) {
      // Un outil sans description est un outil que le modèle n'appellera
      // jamais, ou appellera au hasard : dans les deux cas la case ne mesure
      // pas ce qu'on croit.
      return `tool "${tool.name}" needs a description — it is what the model reads to decide`;
    }

    const params = tool.parameters ?? [];
    if (!Array.isArray(params)) return `tool "${tool.name}": parameters must be a list`;
    const noms = new Set<string>();
    for (const param of params) {
      if (!isFilled(param?.name)) return `tool "${tool.name}": a parameter has no name`;
      if (noms.has(param.name)) {
        return `tool "${tool.name}": two parameters are both named "${param.name}"`;
      }
      noms.add(param.name);
      if (!TOOL_PARAM_TYPES.includes(param.type)) {
        return `tool "${tool.name}", parameter "${param.name}": type must be one of ${TOOL_PARAM_TYPES.join(", ")}`;
      }
    }
  }
  return null;
}

/** Ce qui cloche dans les outils demandés par un scénario, ou null. */
export function scenarioToolsProblem(
  asked: unknown,
  available: ToolSpec[],
  where: string,
): string | null {
  if (asked === undefined || asked === null) return null;
  if (!Array.isArray(asked)) return `${where}: tools must be a list of names`;
  const known = new Set(available.map((tool) => tool.name));
  for (const name of asked) {
    if (!known.has(name)) {
      return `${where}: no tool named "${name}" is defined for this run`;
    }
  }
  return null;
}

/** Ce qui cloche dans un historique posé, ou null.
 *
 * Il s'ouvre sur l'utilisateur et se ferme sur l'assistant, parce que le message
 * d'ouverture est le tour utilisateur qui suit : deux tours utilisateur
 * d'affilée, certains fournisseurs les refusent et les autres les interprètent
 * chacun à leur façon. Le dire ici plutôt qu'au premier appel facturé.
 *
 * L'historique ne consomme aucun tour : `turns` compte les réponses réellement
 * demandées au modèle évalué, à partir du message d'ouverture. */
export function historyProblem(history: unknown, where: string): string | null {
  if (history === undefined || history === null) return null;
  if (!Array.isArray(history)) return `${where}: history must be a list`;
  if (history.length === 0) return null;

  for (const [index, turn] of history.entries()) {
    const role = (turn as SeededTurn)?.role;
    const attendu = index % 2 === 0 ? "user" : "assistant";
    if (role !== attendu) {
      return `${where}: history must alternate user/assistant — turn ${
        index + 1
      } is ${role ?? "empty"} where ${attendu} was expected`;
    }
    if (!isFilled((turn as SeededTurn)?.content)) {
      return `${where}: history turn ${index + 1} is empty`;
    }
  }
  if ((history.at(-1) as SeededTurn).role !== "assistant") {
    return `${where}: history must end on an assistant turn — the opening message is the user turn that follows it`;
  }
  return null;
}

/** Ce qui cloche dans une configuration de run, ou null si elle tient. */
export function configProblem(config: unknown): string | null {
  if (!config || typeof config !== "object") return "config must be an object";
  const c = config as EvalRunConfig;

  if (!Array.isArray(c.scenarios) || c.scenarios.length === 0) {
    return "at least one scenario is required";
  }
  for (const scenario of c.scenarios) {
    if (
      !isFilled(scenario?.title) ||
      !isFilled(scenario?.system_prompt) ||
      !isFilled(scenario?.opening_message)
    ) {
      return "every scenario needs a title, a system prompt and an opening message";
    }
    const history = historyProblem(scenario.history, `scenario "${scenario.title}"`);
    if (history) return history;
  }

  const tools = toolsProblem(c.tools);
  if (tools) return tools;
  const cap = c.max_tool_calls_per_turn;
  if (cap !== undefined && (!Number.isInteger(cap) || cap < 1 || cap > 20)) {
    return "consecutive tool calls per turn must be a whole number between 1 and 20";
  }
  for (const scenario of c.scenarios) {
    const asked = scenarioToolsProblem(
      scenario.tools,
      c.tools ?? [],
      `scenario "${scenario.title}"`,
    );
    if (asked) return asked;
  }

  if (!isFilled(c.criterion)) return "the judge needs something to look at";

  const rubric = rubricProblem(c.rubric);
  if (rubric) return rubric;

  if (!Number.isInteger(c.turns) || c.turns < MIN_TURNS || c.turns > MAX_TURNS) {
    return `turns must be between ${MIN_TURNS} and ${MAX_TURNS}`;
  }
  if (!Number.isInteger(c.repetitions) || c.repetitions < 1) {
    return "repetitions must be at least 1";
  }

  const sortie = c.average_output_tokens;
  if (sortie === undefined || sortie === null) {
    return (
      "average_output_tokens is required: roughly how many output tokens one " +
      "model answer costs, reasoning included, not just the visible reply"
    );
  }
  if (!Number.isInteger(sortie) || sortie < 1 || sortie > 100_000) {
    return "average_output_tokens must be a whole number between 1 and 100000";
  }

  const targets = c.models?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    return "at least one evaluated model is required";
  }
  if (targets.some((target) => !isFilled(target))) {
    return "an evaluated model identifier is empty";
  }
  if (new Set(targets).size !== targets.length) {
    return "the same evaluated model appears more than once";
  }
  if (!isFilled(c.models?.judge)) return "a judge model is required";

  // À un seul tour l'adversaire n'est jamais appelé : ne pas l'exiger évite de
  // faire remplir un champ inutile pour un simple aller-retour.
  if (c.turns > 1) {
    if (!isFilled(c.models?.adversary)) {
      return "an adversary model is required once turns exceeds 1";
    }
    if (!isFilled(c.adversary_prompt)) {
      return "an adversary prompt is required once turns exceeds 1";
    }
  }

  const temperature = c.temperature;
  if (temperature) {
    const { min, max } = temperature;
    if (typeof min !== "number" || min < 0 || min > 2) {
      return "temperature must be between 0 and 2";
    }
    if (max != null && (max < 0 || max > 2 || max < min)) {
      return "the temperature upper bound is below the lower bound";
    }
  }

  return null;
}

/** Ce qui cloche dans une demande de repasse du juge, ou null. */
export function rejudgeProblem(request: unknown): string | null {
  if (!request || typeof request !== "object") return "body must be an object";
  const r = request as RejudgeRequest;
  if (!isFilled(r.criterion)) return "the judge needs something to look at";
  const rubric = rubricProblem(r.rubric);
  if (rubric) return rubric;
  if (!isFilled(r.judge)) return "a judge model is required";
  return null;
}

/** Ce qui cloche dans une demande d'ajout à un run, ou null.
 *
 * `scenarioCount` est la taille de la matrice actuelle : un indice qui la
 * dépasse désignerait un scénario que le job ne saurait pas lire, puisque c'est
 * par cet indice qu'il retrouve le message d'ouverture. */
export function extendProblem(
  request: unknown,
  scenarioCount: number,
  runTools: ToolSpec[] = [],
  currentTurns = 1,
  adversary: string | null = null,
  rubricValues: number[] = [],
): string | null {
  if (!request || typeof request !== "object") return "body must be an object";
  const r = request as ExtendRequest;

  // Les outils ajoutés d'abord : les scénarios qui suivent ont le droit de les
  // nommer, puisqu'ils existeront quand les cases tourneront.
  const ajoutés = r.new_tools ?? [];
  const outils = toolsProblem(ajoutés);
  if (outils) return outils;
  for (const tool of ajoutés) {
    if (runTools.some((existant) => existant.name === tool.name)) {
      // Ajouter un outil est sans effet sur le passé ; en redéfinir un ne
      // l'est pas. Les cases déjà jouées se reliraient comme ayant eu
      // celui-ci, alors qu'elles en avaient un autre sous ce nom.
      return `the run already defines a tool named "${tool.name}"`;
    }
  }
  const disponibles = [...runTools, ...ajoutés];

  const indices = r.scenario_indices;
  if (!Array.isArray(indices)) return "scenario_indices must be a list";
  for (const index of indices) {
    if (!Number.isInteger(index) || index < 0 || index >= scenarioCount) {
      return `scenario ${index} is not part of this run`;
    }
  }

  const nouveaux = r.new_scenarios;
  if (!Array.isArray(nouveaux)) return "new_scenarios must be a list";
  for (const scenario of nouveaux) {
    if (
      !isFilled(scenario?.title) ||
      !isFilled(scenario?.system_prompt) ||
      !isFilled(scenario?.opening_message)
    ) {
      return "every scenario needs a title, a system prompt and an opening message";
    }
    const history = historyProblem(scenario.history, `scenario "${scenario.title}"`);
    if (history) return history;
    const asked = scenarioToolsProblem(
      scenario.tools,
      disponibles,
      `scenario "${scenario.title}"`,
    );
    if (asked) return asked;
  }

  // Un modèle et des répétitions ne désignent rien pour une demande qui ne
  // fait qu'approfondir : aucune case n'est ajoutée, et `cellsForExtension`
  // ne les lit même pas dans ce cas. Ne les exiger que si la demande ajoute
  // effectivement un scénario, existant ou neuf.
  if (indices.length > 0 || nouveaux.length > 0) {
    if (!Array.isArray(r.targets) || r.targets.length === 0) {
      return "at least one model is required";
    }
    if (r.targets.some((target) => !isFilled(target))) {
      return "a model identifier is empty";
    }
    if (new Set(r.targets).size !== r.targets.length) {
      return "the same model appears more than once";
    }

    if (!Number.isInteger(r.repetitions) || r.repetitions < 1) {
      return "repetitions must be at least 1";
    }
  }

  const profondeur = r.turns ?? currentTurns;
  if (!Number.isInteger(profondeur) || profondeur < MIN_TURNS || profondeur > MAX_TURNS) {
    return `turns must be between ${MIN_TURNS} and ${MAX_TURNS}`;
  }
  if (profondeur < currentTurns) {
    // Une conversation déjà jouée ne se coupe pas.
    return `turns cannot go below the ${currentTurns} turns already played`;
  }
  if (profondeur > 1 && !isFilled(adversary)) {
    // Le moteur refuse de dérouler plus d'un tour sans quelqu'un pour pousser.
    return "an adversary model is required once turns exceeds 1";
  }

  const àContinuer = r.deepen;
  if (àContinuer !== undefined && àContinuer !== "all") {
    if (!Array.isArray(àContinuer) || àContinuer.length === 0) {
      return "deepen must be \"all\" or a non-empty list of scores";
    }
    for (const score of àContinuer) {
      if (typeof score !== "number" || !Number.isFinite(score)) {
        return "a score to deepen must be a number";
      }
      if (!rubricValues.includes(score)) {
        // Une note absente du barème ne correspondrait à aucun essai : la
        // demande approfondirait silencieusement zéro essai, ce qui est pire
        // qu'un refus.
        return `score ${score} is not part of this run's rubric`;
      }
    }
  }
  if (àContinuer !== undefined && (r.turns ?? currentTurns) <= currentTurns) {
    // Sans profondeur nouvelle il n'y a rien à continuer : la demande serait
    // silencieusement sans effet, ce qui est pire qu'un refus.
    return "deepening needs more turns to deepen to";
  }

  if (indices.length === 0 && nouveaux.length === 0 && àContinuer === undefined) {
    // Ni scénario à ajouter ni essai à approfondir : la demande tournerait à
    // vide et remettrait pourtant le run en route. Approfondir seul ne tombe
    // plus ici — ça continue de vraies conversations et les rejuge, ce n'est
    // pas à vide.
    return "at least one scenario or a score to deepen is required";
  }

  const temperature = r.temperature;
  if (temperature) {
    const { min, max } = temperature;
    if (typeof min !== "number" || min < 0 || min > 2) {
      return "temperature must be between 0 and 2";
    }
    if (max != null && (max < 0 || max > 2 || max < min)) {
      return "the temperature upper bound is below the lower bound";
    }
  }

  return null;
}
