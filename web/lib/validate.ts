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
} from "./types";

const MIN_TURNS = 1;
const MAX_TURNS = 10;

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

  if (!isFilled(c.criterion)) return "the judge needs something to look at";

  const rubric = rubricProblem(c.rubric);
  if (rubric) return rubric;

  if (!Number.isInteger(c.turns) || c.turns < MIN_TURNS || c.turns > MAX_TURNS) {
    return `turns must be between ${MIN_TURNS} and ${MAX_TURNS}`;
  }
  if (!Number.isInteger(c.repetitions) || c.repetitions < 1) {
    return "repetitions must be at least 1";
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
): string | null {
  if (!request || typeof request !== "object") return "body must be an object";
  const r = request as ExtendRequest;

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
  }

  if (indices.length === 0 && nouveaux.length === 0) {
    // Sans scénario il n'y a pas de case à ajouter : la demande tournerait à
    // vide et remettrait pourtant le run en route.
    return "at least one scenario is required";
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
