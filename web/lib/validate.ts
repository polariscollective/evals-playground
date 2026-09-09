// La validation de ce qu'un client envoie, avant que ça n'entre en base ou ne
// parte dans un job.
//
// Ce que pydantic faisait côté Python. Rien de ce qui arrive du navigateur
// n'est cru : une échelle à un seul palier, un scénario vide ou un multitours
// sans adversaire produiraient un run qui ne mesure rien, et le job n'aurait
// aucun moyen de s'en rendre compte.
import { knownModelIds } from "./catalog.ts";
import { targetsProblem } from "./targets.ts";
import { servesTools } from "./tools.ts";
import type {
  Draft,
  EvalRunConfig,
  ExtendDraft,
  ExtendRequest,
  JudgeSpec,
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

/** Ce qui cloche dans un identifiant de modèle, ou null.
 *
 * Vérifié ici pour la raison qui fait vérifier les noms d'outils juste en
 * dessous : sinon l'erreur tombe au premier appel *facturé*, sous la forme
 * illisible que rend le fournisseur. Un identifiant hors catalogue est en
 * plus compté pour zéro jeton par l'estimation — le devis annoncé serait
 * donc trop bas pour un run qui n'a aucune chance d'aboutir.
 *
 * Le catalogue est la seule liste qui existe : `/prompt` la publie en disant
 * « Use these identifiers exactly. Anything else fails at the first call. »
 * Ce refus ne fait qu'appliquer ce qui est déjà promis. */
function modelProblem(id: unknown, where: string): string | null {
  if (!isFilled(id)) return null;
  if (knownModelIds().has(id)) return null;
  return (
    `${where}: "${id}" is not a model this tool can run. ` +
    "Use one of the identifiers listed in /prompt, exactly as written."
  );
}

/** Ce qui cloche dans une plage de températures, ou null.
 *
 * Une seule copie pour le lancement et pour l'extension : les deux la
 * dupliquaient, avec la même faute des deux côtés — trois violations
 * distinctes rendues sous le seul message « upper bound is below the lower
 * bound », qui envoyait corriger `min` quand c'était `max` qui sortait de
 * l'échelle. */
function temperatureProblem(temperature: unknown): string | null {
  if (!temperature) return null;
  if (typeof temperature !== "object") return "temperature must be a min, or a min and a max";
  const { min, max } = temperature as { min?: unknown; max?: unknown };

  // `min` porte la température quand il n'y a pas de plage — voir le gabarit
  // de `/prompt`, « omit max to use one fixed temperature ». L'exiger plutôt
  // que de lui donner une valeur par défaut évite le piège d'un défaut caché :
  // un fichier qui n'écrivait que `max` recevait « upper bound is below the
  // lower bound » à propos d'une borne basse qu'il n'avait jamais écrite.
  if (typeof min !== "number" || !Number.isFinite(min)) {
    return "temperature needs a min: the fixed temperature, or the bottom of the range";
  }
  if (min < 0 || min > 2) return "temperature must be between 0 and 2";

  if (max === undefined || max === null) return null;
  if (typeof max !== "number" || !Number.isFinite(max)) {
    return "the temperature upper bound must be a number";
  }
  if (max < 0 || max > 2) return "temperature must be between 0 and 2";
  if (max < min) return "the temperature upper bound is below the lower bound";
  return null;
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

/** Ce qui cloche dans UN `JudgeSpec`, ou null si elle tient — que ce soit une
 *  entrée de `config.judges` au lancement (voir `judgesProblem`, juste en
 *  dessous, qui l'appelle pour chacune) ou le corps posté à `.../judges` pour
 *  ajouter un juge après coup (`app/api/runs/[runId]/judges/route.ts`).
 *
 * `label` nomme ce qui cloche dans le message rendu — « judge 2 », ou « the
 * new judge » côté route d'ajout, qui n'a qu'une seule entrée à nommer.
 *
 * `scenarioCount` n'est connu que des appelants qui tiennent le run : la
 * configuration entière (`configProblem`) ou la route d'ajout, qui le lit du
 * run visé. Absent, la liste de cibles est vérifiée sur sa forme et ses
 * valeurs, jamais sur sa longueur — un juge examiné hors de tout run ne peut
 * pas savoir combien de scénarios il devrait couvrir. */
export function judgeSpecProblem(
  spec: unknown,
  label: string,
  scenarioCount?: number,
): string | null {
  if (!spec || typeof spec !== "object") return `${label} is not a mapping`;
  const judge = spec as JudgeSpec;
  if (!isFilled(judge.criterion)) return `${label} needs something to look at`;
  const rubric = rubricProblem(judge.rubric);
  if (rubric) return `${label}: ${rubric}`;
  if (judge.sees_system_prompt !== undefined && typeof judge.sees_system_prompt !== "boolean") {
    return `${label}: sees_system_prompt must be true or false`;
  }
  const targets = targetsProblem(
    judge.targets,
    scenarioCount ?? judge.targets?.length ?? 0,
    judge.rubric,
    label,
  );
  if (targets) return targets;
  // Absent hérite du modèle du run — voir `JudgeSpec.model`. Présent, il
  // doit être un texte non vide : un type différent ne se devine pas, et le
  // laisser passer ferait tourner ce juge sous le modèle par défaut sans que
  // personne ne l'ait demandé, exactement le piège déjà rencontré sur
  // `check_eval_awareness`.
  if (judge.model !== undefined && judge.model !== null && !isFilled(judge.model)) {
    return `${label}: model must be a non-empty string`;
  }
  const model = modelProblem(judge.model, label);
  if (model) return model;
  return null;
}

/** Ce qui cloche dans les juges secondaires d'un run, ou null.
 *
 * `judges` est optionnel : absent ou vide, c'est l'ancienne forme — un seul
 * juge, le principal, décrit par `criterion` et `rubric` au premier niveau
 * de la configuration. Chaque entrée ici en ajoute un de plus, toujours
 * ordinaire — voir la docstring de `JudgeSpec` dans `types.ts` : cette forme
 * ne porte ni type système ni marque de principal, donc rien ici ne peut se
 * substituer au principal ni se faire passer pour un juge d'éveil. Les deux
 * formes ne se contredisent jamais : le premier niveau décrit toujours le
 * principal, `judges` n'ajoute jamais que des juges secondaires. */
export function judgesProblem(
  judges: unknown,
  scenarioCount?: number,
): string | null {
  if (judges === undefined || judges === null) return null;
  if (!Array.isArray(judges)) return "judges must be a list";

  for (const [index, entry] of judges.entries()) {
    const problem = judgeSpecProblem(entry, `judge ${index + 1}`, scenarioCount);
    if (problem) return problem;
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

    // Un outil est fixe ou servi depuis le monde, jamais les deux. Ni l'un ni
    // l'autre reste licite et décrit un outil fixe au résultat vide : `result`
    // vaut `""` par défaut depuis toujours, et casser la relecture des runs
    // déjà en base pour une règle qui n'ajoute rien serait cher payé.
    if (isFilled(tool.result) && isFilled(tool.retrieval_rules)) {
      return (
        `tool "${tool.name}" carries both result and retrieval_rules: ` +
        "a tool is fixed or served from the world, never both"
      );
    }
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

/** Ce qui cloche dans l'équivalence outil-servi / `models.world`, ou null si
 *  elle tient.
 *
 * Servir sans modèle ne répondrait à rien ; nommer un modèle sans rien à
 * servir est un réglage sans effet, et un réglage sans effet est pire
 * qu'absent — on le relit plus tard en se demandant s'il a compté. Miroir du
 * refus Python dans `_monde_et_service_equivalents`, voir
 * `backend/playground/eval_schemas.py`.
 *
 * Extraite de `configProblem` (CRITICAL 1) : `retry` et `catchup` doivent
 * refuser exactement ce que le job refuserait au même titre — cette
 * équivalence-là, et rien de plus — plutôt que la validation de lancement
 * entière, bien plus stricte (`average_output_tokens`, notamment, que le job
 * accepte absent sur un run enregistré avant ce champ). `configProblem` reste
 * l'unique appelant qui doit tout vérifier ; `retry` et `catchup` n'ont besoin
 * que de celle-ci, et l'appellent désormais directement — une définition,
 * trois appelants. */
export function worldEquivalenceProblem(
  config: Pick<EvalRunConfig, "tools" | "models">,
): string | null {
  const sert = servesTools(config.tools ?? []);
  const monde = isFilled(config.models?.world);
  if (sert && !monde) {
    return (
      "models.world: this run serves at least one tool, so it needs a model to " +
      "answer those calls. Pick one from the models listed in /prompt."
    );
  }
  if (!sert && monde) {
    return (
      "models.world: no tool in this run has retrieval_rules, so nothing is " +
      "served and this model would never be called. Remove it, or give a tool " +
      "reading rules."
    );
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

  // Un booléen ou rien, jamais autre chose. Une chaîne "false" écrite par
  // mégarde entre guillemets n'est pas égale au booléen `false` : la laisser
  // passer ici la ferait lire plus loin comme l'interrupteur resté allumé,
  // sans que personne ne le sache — un juge qu'on a explicitement demandé
  // d'éteindre continuerait de tourner et d'être facturé.
  const eveil = c.check_eval_awareness;
  if (eveil !== undefined && typeof eveil !== "boolean") {
    return "check_eval_awareness must be true or false";
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

  if (c.sees_system_prompt !== undefined && typeof c.sees_system_prompt !== "boolean") {
    return "sees_system_prompt must be true or false";
  }
  // Le principal se décrit au premier niveau, comme `criterion` et `rubric` —
  // d'où ce contrôle ici plutôt que dans `judgesProblem`, qui ne voit que les
  // secondaires.
  const principalTargets = targetsProblem(
    c.targets,
    c.scenarios.length,
    c.rubric,
    "the principal judge",
  );
  if (principalTargets) return principalTargets;

  const judges = judgesProblem(c.judges, c.scenarios.length);
  if (judges) return judges;

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

  // Après les règles de structure, et pas avant : un adversaire manquant ou
  // un modèle en double sont des fautes de forme, qu'il vaut mieux annoncer
  // avant d'aller lire un identifiant. Sinon un document à qui il manque
  // l'adversaire s'entendrait reprocher le nom de son modèle évalué.
  for (const target of targets) {
    const problem = modelProblem(target, "evaluated model");
    if (problem) return problem;
  }
  const judgeModel = modelProblem(c.models?.judge, "judge model");
  if (judgeModel) return judgeModel;
  const adversaryModel = modelProblem(c.models?.adversary, "adversary model");
  if (adversaryModel) return adversaryModel;
  const worldModel = modelProblem(c.models?.world, "world model");
  if (worldModel) return worldModel;

  // L'équivalence, dans les deux sens — voir `worldEquivalenceProblem`, qui
  // porte seule cette règle désormais.
  const worldEquivalence = worldEquivalenceProblem(c);
  if (worldEquivalence) return worldEquivalence;

  const temperature = temperatureProblem(c.temperature);
  if (temperature) return temperature;

  return null;
}

/** Ce qui cloche dans une demande d'ajout à un run, ou null.
 *
 * `scenarioCount` est la taille de la matrice actuelle : un indice qui la
 * dépasse désignerait un scénario que le job ne saurait pas lire, puisque c'est
 * par cet indice qu'il retrouve le message d'ouverture.
 *
 * `runWorldModel` est `models.world` du run tel qu'il est avant cette
 * extension — `null` quand le run n'en a encore aucun, que ce soit parce qu'il
 * ne sert rien ou parce qu'il a été lancé avant que ce modèle ne se choisisse.
 * Ajouté en dernier pour ne déplacer aucun appelant existant. */
export function extendProblem(
  request: unknown,
  scenarioCount: number,
  runTools: ToolSpec[] = [],
  currentTurns = 1,
  adversary: string | null = null,
  rubricValues: number[] = [],
  runWorldModel: string | null = null,
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

  // Trois cas, et le troisième est le seul qui surprenne : un run qui sert
  // déjà impose son modèle. Deux serveurs dans un même run rendraient ses
  // cases incomparables, et c'est la seule chose qu'une matrice ne survit pas.
  // Placé avant le reste — scénarios, modèles, répétitions — pour qu'une
  // demande qui ne fait qu'ajouter un outil servi sans nommer de monde ne
  // s'entende pas d'abord reprocher un champ qu'elle n'a pas à porter.
  // L'union du déjà-là et de l'ajouté, pas seulement l'ajouté : un run lancé
  // avant ce chantier sert déjà des outils sans `models.world` (`runWorldModel`
  // est alors `null`), et c'est le cas qui doit exiger un modèle — pas une
  // extension qui n'ajoute rien de servi mais touche un run qui, lui, sert.
  const sertUneFoisAppliquée = servesTools(disponibles);
  const nommé = isFilled(r.world);
  const worldModel = modelProblem(r.world, "world");
  if (worldModel) return worldModel;
  if (runWorldModel) {
    if (nommé && r.world !== runWorldModel) {
      return (
        `world: this run already serves its tools with "${runWorldModel}". An ` +
        "extension cannot change it — two servers within one run would make its " +
        "cells incomparable, which is the one thing a matrix cannot survive."
      );
    }
  } else if (sertUneFoisAppliquée) {
    if (!nommé) {
      return (
        "world: this run serves at least one tool but names no model to answer " +
        "its calls, so this extension needs to name one — it becomes the run's."
      );
    }
  } else if (nommé) {
    return (
      "world: this extension adds no served tool and the run serves none, so " +
      "this model would never be called."
    );
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
    for (const target of r.targets) {
      const problem = modelProblem(target, "model");
      if (problem) return problem;
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

  const nouveauxJuges = r.new_judges ?? [];
  if (!Array.isArray(nouveauxJuges)) return "new_judges must be a list";
  for (const [index, spec] of nouveauxJuges.entries()) {
    const problem = judgeSpecProblem(spec, `new judge ${index + 1}`);
    if (problem) return problem;
  }
  if (nouveauxJuges.length > 0) {
    // Le moteur a deux passes, et un lancement n'en fait qu'une : `run` joue
    // les cases neuves et les fait noter par tous les juges vivants ;
    // `catchup` remplit les verdicts manquants sur les conversations déjà
    // finies. Un appel qui ferait les deux laisserait le juge neuf sans
    // verdict sur tout ce qui était déjà joué — la moitié d'un travail
    // pourtant chiffré et payé. Deux appels, chacun net.
    const aussi =
      indices.length > 0 ||
      nouveaux.length > 0 ||
      àContinuer !== undefined ||
      (r.new_tools ?? []).length > 0 ||
      (r.turns !== undefined && r.turns !== currentTurns);
    if (aussi) {
      return (
        "adding a judge is its own extension: it re-reads conversations that are already " +
        "played, while adding scenarios, models, turns or tools plays new ones. One launch " +
        "does one of the two. Send this call with new_judges alone, and the rest as a second one."
      );
    }
  }

  // Poser un juge est un contenu comme un autre : la demande ne tourne pas à
  // vide, elle fait relire au juge neuf tout ce qui est déjà joué.
  if (
    indices.length === 0 &&
    nouveaux.length === 0 &&
    àContinuer === undefined &&
    nouveauxJuges.length === 0
  ) {
    // Ni scénario à ajouter ni essai à approfondir : la demande tournerait à
    // vide et remettrait pourtant le run en route. Approfondir seul ne tombe
    // plus ici — ça continue de vraies conversations et les rejuge, ce n'est
    // pas à vide.
    return "at least one scenario, a score to deepen, or a judge to add is required";
  }

  const temperature = temperatureProblem(r.temperature);
  if (temperature) return temperature;

  return null;
}

/** Pourquoi une extension déjà appliquée ne se réapplique pas — ou `null` tant
 *  qu'elle attend.
 *
 * Réappliquer n'est pas idempotent, et c'est ce qui rend ce refus nécessaire
 * plutôt que confortable : `cellsForExtension` numérote les répétitions à partir
 * de la dernière, si bien qu'une seconde application empile des essais au lieu
 * de constater qu'il n'y a rien à faire, et réécrit les `new_scenarios` une
 * seconde fois dans le run. Le filet `added === 0` ne rattrape que l'extension
 * qui n'ajoutait déjà rien.
 *
 * Un brouillon de run lancé, lui, reste relançable : il produit un run de plus,
 * sans toucher au premier. C'est la même règle qui est bonne d'un côté et
 * fausse de l'autre — d'où ce prédicat, qui ne vaut que pour les extensions. */
export function alreadyAppliedProblem(draft: ExtendDraft): string | null {
  if (!draft.launched_at) return null;
  return (
    `This extension was already applied to run ${draft.extends_run_id} on ` +
    `${draft.launched_at}. Applying it again would add to what it already added, not ` +
    "repeat it. See the run's Extensions history for what it did, and compose a new " +
    "extension on the run's page if you mean to go further."
  );
}

/** Ce qui interdit d'appliquer ce brouillon au run `runId` — ou `null` s'il peut
 *  servir.
 *
 * Trois refus, dans l'ordre où ils cessent d'être vrais : ce n'est pas une
 * extension, elle vise un autre run, elle a déjà servi. Pour la route HTTP, qui
 * reçoit le brouillon et le run par deux chemins indépendants — l'adresse et un
 * paramètre — et n'a donc rien qui garantisse d'avance qu'ils vont ensemble. */
export function extensionDraftProblem(draft: Draft, runId: string): string | null {
  if (draft.kind !== "extend") {
    return `Draft ${draft.id} is a run to launch, not an extension of a run.`;
  }
  if (draft.extends_run_id !== runId) {
    return `Draft ${draft.id} extends run ${draft.extends_run_id}, not ${runId}.`;
  }
  return alreadyAppliedProblem(draft);
}
