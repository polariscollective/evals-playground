// Lire et écrire les runs. Le seul endroit qui connaît la forme des deux tables.
import "server-only";
// La matrice se calcule là où on la regarde : l'écran laisse relire un run
// autrement — une médiane, une échelle repliée — et deux calculs de la même
// chose finiraient par ne plus dire pareil.
import { overallMean, progressOf } from "./matrix";
import {
  NOW,
  RUNS,
  RUN_TAGS,
  SAMPLES,
  failStaleRuns,
  insert,
  remove,
  select,
  update,
} from "./supabase";
import { addEstimates, estimateCost } from "./pricing";
import { estimateExtension } from "./extend-estimate";
import { measureRun, type MeasurableCell } from "./measured-length";
import { spendOf } from "./mcp-budget";
import { cellsForExtension, cellsForRun, coupleKey } from "./cells";
import { withoutIdentity } from "./public-run";
import type { PublicRunDetail } from "./public-run";
import type {
  EvalRun,
  EvalRunConfig,
  EvalSample,
  ExtendRequest,
  RunDetail,
  RunSummary,
} from "./types";

/** Les colonnes d'une case, sauf le transcript.
 *
 * Un transcript pèse plusieurs kilo-octets ; les ramener tous pour compter des
 * statuts ferait passer des mégaoctets par le réseau à chaque rafraîchissement,
 * toutes les trois secondes pendant qu'un run tourne. */
const SAMPLE_COLUMNS =
  "id,run_id,scenario_index,scenario_title,target_model,repetition,status," +
  // `usage` porte les jetons facturés de la case. Petit — cinq compteurs par
  // modèle — et sans commune mesure avec les transcripts, qu'on continue de ne
  // ramener que sur demande. C'est ce qui permet au panneau d'annoncer sur quoi
  // son devis repose, et à `extendRun` de le calculer pareil.
  "temperature,score,justification,error,started_at,finished_at,cost_usd,usage";

export class NotFound extends Error {}

/** Combien d'essais chaque couple scénario × modèle porte : le moins, le plus.
 *
 * Compté sur les cases plutôt que lu dans `config.repetitions`, qui ne dit que
 * ce qui avait été demandé au dernier lot : un run complété a des couples plus
 * fournis que d'autres, et une moyenne de case porte alors sur moins de
 * conversations que sa voisine. */
function repetitionRange(samples: EvalSample[]): [number, number] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = coupleKey(sample.scenario_index, sample.target_model);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}


/** Tous les runs, du plus récent au plus ancien, avec leur avancement.
 *
 * Les cases sont lues en une seule requête pour tous les runs, sans leurs
 * transcripts : les colonnes ramenées sont minuscules, et une requête par run
 * serait bien plus coûteuse. Si la table grossissait au point que ça pèse, une
 * vue d'agrégation en base serait le remède — pas une pagination des cases. */
export async function loadRuns(): Promise<RunSummary[]> {
  await failStaleRuns();

  const runs = await select<EvalRun>(RUNS, {
    select: "*",
    // Un run écarté ne se lit plus nulle part : ni la liste, ni la page
    // publique, ni les outils MCP, qui passent tous par ici.
    deleted_at: "is.null",
    order: "created_at.desc",
  });
  if (runs.length === 0) return [];

  // Les coordonnées de chaque case en plus des statuts : c'est par elles qu'on
  // voit qu'un run complété n'a plus le même nombre d'essais partout. Deux
  // petites colonnes de plus, à comparer aux transcripts qu'on ne ramène pas.
  const samples = await select<EvalSample>(SAMPLES, {
    select: "run_id,status,score,scenario_index,target_model",
  });

  const byRun = new Map<string, EvalSample[]>();
  for (const sample of samples) {
    const list = byRun.get(sample.run_id);
    if (list) list.push(sample);
    else byRun.set(sample.run_id, [sample]);
  }

  return runs.map((run) => {
    const own = byRun.get(run.id) ?? [];
    return {
      run,
      progress: progressOf(own),
      mean: overallMean(own, run.config.rubric),
      repetitions: repetitionRange(own),
    };
  });
}

/** Un run et ses cases.
 *
 * `withTranscripts` ne sert qu'à l'ouverture d'une case et aux exports : le
 * rafraîchissement d'un run en cours n'en a pas besoin.
 *
 * Throws:
 *   NotFound: si aucun run ne porte cet identifiant.
 */
export async function loadRun(
  runId: string,
  options: { withTranscripts?: boolean; withSourceCsvFlag?: boolean } = {},
): Promise<RunDetail> {
  await failStaleRuns();

  const runs = await select<EvalRun>(RUNS, {
    id: `eq.${runId}`,
    select: "*",
    deleted_at: "is.null",
    limit: 1,
  });
  // Écarté ou inexistant lèvent la même erreur : de dehors, les deux doivent
  // se ressembler.
  if (runs.length === 0) throw new NotFound(`Unknown run: ${runId}`);
  const run = runs[0];

  const samples = await select<EvalSample>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: options.withTranscripts ? "*" : SAMPLE_COLUMNS,
    order: "scenario_index.asc,target_model.asc,repetition.asc",
  });
  for (const sample of samples) {
    sample.messages ??= [];
    sample.usage ??= {};
  }

  // `sourceCsv` ramène la colonne entière — plusieurs centaines de kilo-octets
  // possibles — pour n'en garder qu'un booléen. `loadPublicRun` n'a personne à
  // qui le montrer : le bouton de téléchargement n'existe que sur la page
  // privée. Lui épargner cette lecture est le seul but de `withSourceCsvFlag`.
  const sourceCsvAvailable =
    options.withSourceCsvFlag === false ? false : Boolean(await sourceCsv(runId));

  return {
    run,
    samples,
    progress: progressOf(samples),
    source_csv_available: sourceCsvAvailable,
  };
}

/** Le CSV téléversé au lancement, ou null s'il n'y en a pas eu.
 *
 * Lu à part du run : la colonne peut peser plusieurs centaines de kilo-octets,
 * et aucune autre lecture n'en a besoin. */
export async function sourceCsv(runId: string): Promise<string | null> {
  const rows = await select<{ source_csv: string | null }>(RUNS, {
    id: `eq.${runId}`,
    select: "source_csv",
    limit: 1,
  });
  return rows[0]?.source_csv ?? null;
}

/** Crée un run et toute sa matrice, en attente.
 *
 * Les cases sont écrites au lancement, pas par le job : c'est ce qui rend la
 * progression exacte avant même que le job démarre, et ce qui permet d'afficher
 * la matrice grisée dès la première seconde.
 *
 * `launchedVia` vaut `'ui'` par défaut : les appelants d'avant cette colonne
 * — le formulaire, la route de lancement d'un brouillon — n'ont rien à changer
 * pour continuer à écrire ce qu'ils écrivaient déjà. Seul l'outil MCP
 * `launch_draft` passe `'mcp'`, la seule valeur que compte le budget de
 * `mcp-budget.ts`. */
export async function createRun(
  config: EvalRunConfig,
  userEmail: string,
  csvText: string | null,
  draftId: string | null = null,
  launchedVia: "ui" | "mcp" = "ui",
): Promise<EvalRun> {
  const total =
    config.scenarios.length * config.models.targets.length * config.repetitions;

  const created = await insert<EvalRun>(
    RUNS,
    {
      user_email: userEmail,
      label: config.label?.trim() || null,
      config,
      notes: config.notes ?? "",
      source_csv: csvText,
      total_samples: total,
      // Recalculé ici et non repris du navigateur : le devis enregistré doit
      // être celui que ce code produit, pas celui qu'un client affirme avoir
      // vu. Sans ça, la comparaison d'après ne mesurerait plus rien. La
      // longueur supposée, elle, vient bien du client — mais par la config,
      // qui est validée, et non par un paramètre à côté.
      estimate: estimateCost(config),
      // D'où il sort, quand il sort d'un brouillon. Porté par le run et non
      // par le brouillon : relancer le même brouillon est prévu, et une case
      // unique de l'autre côté écraserait le run précédent.
      draft_id: draftId,
      launched_via: launchedVia,
    },
    { returning: true },
  );
  const run = created[0];

  // La température est posée ici, pas calculée par le job : un run qu'on
  // complétera plus tard verra ses nouvelles répétitions étalées à part, et
  // recalculer depuis `config.repetitions` réécrirait alors la température des
  // cases déjà payées.
  await insert(
    SAMPLES,
    cellsForRun(config).map((cell) => ({ run_id: run.id, ...cell })),
  );

  return run;
}

/** Ce qu'un appelant a lancé par MCP sur l'heure qui vient de s'écouler,
 *  additionné : le coût réel de chaque run fini, son devis pour les autres —
 *  voir `spendOf` dans `mcp-budget.ts`, qui porte la raison de ce choix.
 *
 * Filtré sur `user_email`, `launched_via = 'mcp'` et `created_at` : exactement
 * la lecture que couvre l'index partiel posé avec la colonne. Un run lancé
 * depuis l'écran ne compte jamais ici, quel qu'en soit l'auteur — c'est tout
 * le sens de la colonne. */
export async function mcpSpendLastHour(userEmail: string): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const runs = await select<{ cost_usd: number | null; estimate: EvalRun["estimate"] }>(
    RUNS,
    {
      select: "cost_usd,estimate",
      user_email: `eq.${userEmail}`,
      launched_via: "eq.mcp",
      created_at: `gte.${since}`,
    },
  );
  return runs.reduce((total, run) => total + spendOf(run), 0);
}

/** Prépare un run pour une nouvelle passe de juge.
 *
 * Franchement destructif, et il le dit : notes et justifications sont effacées
 * partout avant que la passe ne commence. L'atomicité — une passe ratée
 * laisserait les anciennes notes — n'est pas atteignable avec l'écriture au fil
 * de l'eau : la première case recevrait sa nouvelle note pendant que la
 * cinquantième porterait encore l'ancienne. Entre un mélange silencieux de deux
 * échelles et des trous francs, ce sont les trous qui se voient. */
export async function resetForRejudge(
  runId: string,
  config: EvalRunConfig,
): Promise<void> {
  await update(
    SAMPLES,
    { status: "pending", score: null, justification: "", error: null, finished_at: null },
    { run_id: `eq.${runId}` },
  );
  await update(
    RUNS,
    { config, status: "running", error: null, started_at: NOW, finished_at: null },
    { id: `eq.${runId}` },
  );
}

/** Demande l'arrêt : le job le lit avant chaque case et se termine lui-même.
 *
 * Seul le run est marqué. Les cases restantes sont passées en `cancelled` par
 * le job, pas ici — c'est lui qui sait lesquelles il n'a pas faites, et le
 * faire des deux côtés produirait deux vérités sur la même ligne. */
export async function cancelRun(runId: string): Promise<void> {
  await update(RUNS, { status: "cancelled" }, { id: `eq.${runId}` });
}

export async function saveNotes(runId: string, notes: string): Promise<void> {
  await update(RUNS, { notes }, { id: `eq.${runId}` });
}

/** Écrite après coup, jamais portée par `config` : voir `EvalRun.analysis`. */
export async function saveAnalysis(runId: string, analysis: string): Promise<void> {
  await update(RUNS, { analysis }, { id: `eq.${runId}` });
}

export async function recordStart(
  runId: string,
  started: { execution: string; origin: string },
): Promise<void> {
  await update(RUNS, started, { id: `eq.${runId}` });
}

/** Marque un run comme mort-né : le job n'a pas pu être démarré.
 *
 * Sans ça, il resterait `pending` indéfiniment — jusqu'à ce que la fonction
 * d'expiration le ramasse deux heures plus tard, avec un message qui parlerait
 * d'un job disparu plutôt que d'un job jamais lancé. */
export async function failToStart(runId: string, reason: string): Promise<void> {
  await update(
    RUNS,
    { status: "error", error: reason, finished_at: NOW },
    { id: `eq.${runId}` },
  );
  await update(
    SAMPLES,
    { status: "error", error: reason, finished_at: NOW },
    { run_id: `eq.${runId}`, status: "in.(pending,running)" },
  );
}

/** Remet les cases en erreur à faire, dans le même run.
 *
 * Le même run, et pas un nouveau : une panne de fournisseur sur quinze cases
 * n'est pas une autre expérience, et la matrice doit se refermer là où elle
 * s'est trouée. Les transcripts partiels sont effacés — ce qui a échoué à
 * mi-conversation ne doit pas se mélanger à la nouvelle tentative.
 *
 * Renvoie le nombre de cases remises en jeu, zéro s'il n'y en avait aucune. */
export async function retryFailed(runId: string): Promise<number> {
  const failed = await select<{ id: string }>(SAMPLES, {
    select: "id",
    run_id: `eq.${runId}`,
    status: "eq.error",
  });
  if (failed.length === 0) return 0;

  await update(
    SAMPLES,
    {
      status: "pending",
      score: null,
      justification: "",
      messages: [],
      error: null,
      started_at: null,
      finished_at: null,
    },
    { run_id: `eq.${runId}`, status: "eq.error" },
  );
  await update(
    RUNS,
    { status: "triggered", error: null, finished_at: null },
    { id: `eq.${runId}` },
  );
  return failed.length;
}

/** Ajoute une sous-matrice à un run existant.
 *
 * Les cases déjà notées ne sont pas touchées : seules les nouvelles naissent en
 * `pending`, et le job ne déroule que celles-là. Les répétitions ajoutées
 * continuent la numérotation de leur couple plutôt que de repartir de zéro, ce
 * qui est aussi ce qui empêche la contrainte d'unicité de refuser l'insertion.
 *
 * Renvoie le nombre de cases ajoutées, plus celles remises en attente pour
 * être continuées. */
export async function extendRun(
  runId: string,
  request: ExtendRequest,
): Promise<number> {
  const runs = await select<EvalRun>(RUNS, { select: "*", id: `eq.${runId}` });
  const run = runs[0];
  if (!run) throw new NotFound(runId);

  const config = run.config;

  // Les outils du run après cette extension. `extendProblem` a déjà refusé un
  // nom qui en redéfinirait un : ajouter est sans effet sur le passé.
  const outilsAvant = config.tools ?? [];
  const outils = [...outilsAvant, ...(request.new_tools ?? [])];

  // Un scénario sans clé `tools` veut dire « tous ceux du run », résolu à la
  // lecture et non figé à l'exécution. Ajouter un outil le lui donnerait donc
  // rétroactivement — non pas dans les cases déjà jouées, qui sont faites,
  // mais dans toute ré-exécution de ce scénario. Quand on ne le veut pas, on
  // écrit noir sur blanc les outils qui existaient : même comportement, rendu
  // explicite au moment où il allait cesser d'être vrai.
  const gèle =
    (request.new_tools ?? []).length > 0 &&
    request.new_tools_for_existing === false;
  const anciens = gèle
    ? config.scenarios.map((scenario) =>
        scenario.tools == null
          ? { ...scenario, tools: outilsAvant.map((tool) => tool.name) }
          : scenario,
      )
    : config.scenarios;

  const scenarios = [...anciens, ...request.new_scenarios];
  const nouveaux = request.new_scenarios.map(
    (_, offset) => anciens.length + offset,
  );
  const indices = [...new Set([...request.scenario_indices, ...nouveaux])].sort(
    (a, b) => a - b,
  );
  const targets = [...new Set([...config.models.targets, ...request.targets])];
  const temperature =
    request.temperature === undefined ? config.temperature : request.temperature;

  // Où en est chaque couple : les répétitions ajoutées reprennent après la
  // dernière, sans quoi elles entreraient en collision avec les existantes et
  // la contrainte d'unicité refuserait l'insertion.
  const existantes = await select<{
    scenario_index: number;
    target_model: string;
    repetition: number;
  }>(SAMPLES, {
    select: "scenario_index,target_model,repetition",
    run_id: `eq.${runId}`,
  });
  const dernier = new Map<string, number>();
  for (const cell of existantes) {
    const key = coupleKey(cell.scenario_index, cell.target_model);
    dernier.set(key, Math.max(dernier.get(key) ?? -1, cell.repetition));
  }

  const cases = cellsForExtension(
    scenarios,
    indices,
    request.targets,
    request.repetitions,
    temperature,
    dernier,
  );

  // Les essais retenus pour l'approfondissement : notés, dans ce run, et —
  // quand une liste de notes est donnée — parmi celles-là. `score=in.(...)`
  // exclut déjà les essais sans note, une liste de nombres ne contenant
  // jamais `null` ; `not.is.null` fait ce travail pour "all". Un `select`
  // d'abord donne le compte ; le `update` plus bas porte le même filtre, en
  // une seule écriture plutôt qu'en boucle — une panne au milieu d'une boucle
  // n'y laisserait qu'un effet partiel.
  const filtreDeepen = {
    run_id: `eq.${runId}`,
    status: "eq.done",
    score: Array.isArray(request.deepen)
      ? `in.(${request.deepen.join(",")})`
      : "not.is.null",
  };
  const àContinuer =
    request.deepen === undefined
      ? []
      : await select<{ target_model: string; turns_done: number | null }>(
          SAMPLES,
          { select: "target_model,turns_done", ...filtreDeepen },
        );
  // Une extension qui n'approfondit que des essais existants n'ajoute aucune
  // case neuve ; ce n'est pas pour autant qu'il n'y a rien à faire.
  const continuées = àContinuer.length;
  if (cases.length === 0 && continuées === 0) return 0;

  // Ce que le run sait de lui-même. Quatre colonnes seulement : les
  // transcripts pèsent des centaines de kilo-octets et la mesure n'en a pas
  // besoin, `usage` portant les jetons réellement facturés.
  const jouees = await select<MeasurableCell>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: "scenario_index,target_model,status,usage",
  });
  for (const cell of jouees) cell.usage ??= {};
  const mesure = measureRun(jouees, config.models, config.turns);

  // Les scénarios réellement ajoutés, chacun avec son index dans le run : un
  // décalage donnerait à un scénario la longueur mesurée d'un autre, en
  // silence.
  const retenus = indices
    .filter((index) => Boolean(scenarios[index]))
    .map((index) => ({ index, scenario: scenarios[index] }));

  // Le devis de l'extension, puis additionné à celui du run : sans ça,
  // « devis vs réel » opposerait un coût qui a grandi à une estimation restée
  // sur la première matrice, et ne mesurerait plus l'estimation mais l'ajout.
  //
  // Le calcul lui-même est celui du panneau, à la lettre : `estimateExtension`
  // est appelée ici et là-bas, sur les mêmes longueurs mesurées. Deux calculs
  // séparés avaient divergé d'un facteur trois sans que rien ne le dise.
  const ajout = estimateExtension(
    config,
    {
      scenarios: retenus,
      targets: request.targets,
      repetitions: request.repetitions,
      // La profondeur demandée, pas celle d'avant : les cases neuves
      // tourneront à la nouvelle, puisque la configuration l'aura déjà reçue.
      turns: request.turns ?? config.turns,
      tools: outils,
      deepen: àContinuer,
    },
    mesure,
  );

  // La configuration du run porte la nouvelle profondeur avant toute autre
  // écriture : une panne plus loin doit trouver un run qui déclare déjà
  // `turns`, plutôt qu'une case remise en attente que rien n'explique encore.
  await update(
    RUNS,
    {
      config: {
        ...config,
        tools: outils,
        turns: request.turns ?? config.turns,
        scenarios,
        models: { ...config.models, targets },
        temperature,
      },
      total_samples: run.total_samples + cases.length,
      estimate: ajout ? addEstimates(run.estimate, ajout) : run.estimate,
      status: "triggered",
      error: null,
      finished_at: null,
    },
    { id: `eq.${runId}` },
  );

  await insert(
    SAMPLES,
    cases.map((cell) => ({ run_id: runId, ...cell })),
  );

  // Les essais à continuer repartent en attente en gardant leur conversation :
  // c'est ce couple — `pending` avec des `messages` — qui dit au moteur de
  // continuer plutôt que de rejouer. `turns_done` ne bouge pas : c'est lui,
  // comparé à `config.turns` déjà écrit ci-dessus, qui distinguera un essai à
  // poursuivre d'un essai déjà à sa profondeur.
  //
  // Leur note part maintenant, pas après. Elle portait sur une conversation
  // plus courte et ne dit rien de celle qui vient ; une panne en cours de
  // route doit laisser un essai sans note plutôt qu'un essai portant un
  // verdict qui ne correspond plus.
  if (continuées > 0) {
    await update(
      SAMPLES,
      {
        status: "pending",
        score: null,
        justification: "",
        error: null,
        finished_at: null,
      },
      filtreDeepen,
    );
  }

  return cases.length + continuées;
}

/** Un run publié, tel qu'un inconnu peut le lire.
 *
 * Un run inconnu et un run non publié lèvent la même erreur, avec le même
 * message : de dehors, les deux doivent se ressembler, sinon l'adresse dit qui
 * existe.
 *
 * La seule écriture qui a lieu ici passe par `loadRun`, qui purge les runs
 * bloqués avant même de savoir si celui-ci est public — `failStaleRuns` tourne
 * pour tout appelant, authentifié ou non. Sans danger : son prédicat ne dépend
 * que de `status` et `updated_at`, jamais de ce que l'appelant fournit, et
 * l'appel est throttlé à une fois toutes les 30 secondes par processus. Mais
 * ce n'est pas rien non plus — le nommer ici évite qu'un futur appel ajouté
 * dans `loadRun` s'y glisse sans que quiconque se demande s'il est encore
 * acceptable devant un appelant anonyme.
 *
 * Throws:
 *   NotFound: si aucun run ne porte cet identifiant, ou s'il n'est pas publié.
 */
export async function loadPublicRun(
  runId: string,
  options: { withTranscripts?: boolean } = {},
): Promise<PublicRunDetail> {
  const detail = await loadRun(runId, { ...options, withSourceCsvFlag: false });
  if (!detail.run.is_public) throw new NotFound(`Unknown run: ${runId}`);
  return withoutIdentity(detail);
}

/** Écarter un run des listes et de la lecture publique, sans rien effacer.
 *
 * Un run coûte de l'argent et porte des notes : le rendre irrécupérable sur un
 * clic serait disproportionné. La ligne reste, `deleted_at` la sort de partout
 * — `loadRun` et `loadRuns` filtrent dessus, donc la page, la liste, la
 * lecture publique et les outils MCP l'ignorent tous du même coup.
 *
 * Le run une fois marqué, ses liens de tags sont retirés : un tag ne vit que
 * tant qu'une chose *vivante* le porte, et la mise à la corbeille ne compte
 * plus comme vivante. Le déclencheur `delete_orphan_tag` fait le reste — si
 * ce lien était le dernier, le tag disparaît avec lui. Sans ce retrait, un
 * run à la corbeille garderait un tag en vie sans qu'on le voie nulle part.
 *
 * `deleted_at` est posé avant : si le retrait des liens échoue, le run reste
 * simplement à la corbeille avec ses tags encore accrochés — l'état
 * d'aujourd'hui, sans danger. L'ordre inverse détacherait les tags d'un run
 * qui, si la suppression suivante échouait, ne serait même pas écarté. */
export async function softDeleteRun(runId: string): Promise<void> {
  await update(RUNS, { deleted_at: NOW }, { id: `eq.${runId}` });
  await remove(RUN_TAGS, { run_id: `eq.${runId}` });
}

/** Publier ou dépublier. Le seul endroit qui écrit cette colonne. */
export async function setPublic(runId: string, isPublic: boolean): Promise<void> {
  await update(RUNS, { is_public: isPublic }, { id: `eq.${runId}` });
}

/** Une seule conversation, sans charger le reste du run — un run porte des
 *  dizaines de cases, et les ramener toutes pour n'en rendre qu'une serait le
 *  genre de coût caché qui ne se voit qu'en production.
 *
 * Le run est vérifié d'abord, et c'est le seul but de cette lecture : les cases
 * ne portent pas `deleted_at`, il vit sur le run. Sans ce contrôle, un run
 * écarté continuerait de rendre ses trajectoires une à une — la seule porte
 * qu'un filtre posé sur `eval_samples` seul n'aurait pas fermée.
 *
 * Throws:
 *   NotFound: si le run est inconnu ou écarté, ou si aucune case ne porte ce
 *   triplet.
 */
export async function loadSampleTranscript(
  runId: string,
  scenarioIndex: number,
  targetModel: string,
  repetition: number,
): Promise<EvalSample> {
  const vivants = await select<{ id: string }>(RUNS, {
    id: `eq.${runId}`,
    select: "id",
    deleted_at: "is.null",
    limit: 1,
  });
  if (vivants.length === 0) throw new NotFound(`Unknown run: ${runId}`);

  const rows = await select<EvalSample>(SAMPLES, {
    run_id: `eq.${runId}`,
    scenario_index: `eq.${scenarioIndex}`,
    target_model: `eq.${targetModel}`,
    repetition: `eq.${repetition}`,
    select: "*",
    limit: 1,
  });
  const sample = rows[0];
  if (!sample) {
    throw new NotFound(
      `Unknown sample: run ${runId}, scenario ${scenarioIndex}, ${targetModel}, repetition ${repetition}`,
    );
  }
  sample.messages ??= [];
  sample.usage ??= {};
  return sample;
}
