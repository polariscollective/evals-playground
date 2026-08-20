// Lire et écrire les runs. Le seul endroit qui connaît la forme des deux tables.
import "server-only";
import { cellsOf, overallMean, progressOf } from "./matrix";
import {
  NOW,
  RUNS,
  SAMPLES,
  failStaleRuns,
  insert,
  select,
  update,
} from "./supabase";
import { estimateCost } from "./pricing";
import type {
  EvalRun,
  EvalRunConfig,
  EvalSample,
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
  "temperature,score,justification,error,started_at,finished_at,cost_usd";

export class NotFound extends Error {}

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
    order: "created_at.desc",
  });
  if (runs.length === 0) return [];

  const samples = await select<EvalSample>(SAMPLES, {
    select: "run_id,status,score",
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
  options: { withTranscripts?: boolean } = {},
): Promise<RunDetail> {
  await failStaleRuns();

  const runs = await select<EvalRun>(RUNS, {
    id: `eq.${runId}`,
    select: "*",
    limit: 1,
  });
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

  return {
    run,
    samples,
    progress: progressOf(samples),
    cells: cellsOf(samples, run.config.scenarios.length, run.config.rubric),
    source_csv_available: Boolean(await sourceCsv(runId)),
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
 * la matrice grisée dès la première seconde. */
export async function createRun(
  config: EvalRunConfig,
  userEmail: string,
  csvText: string | null,
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
      // vu. Sans ça, la comparaison d'après ne mesurerait plus rien.
      estimate: estimateCost(config),
    },
    { returning: true },
  );
  const run = created[0];

  const cases = [];
  for (const [index, scenario] of config.scenarios.entries()) {
    for (const target of config.models.targets) {
      for (let repetition = 0; repetition < config.repetitions; repetition += 1) {
        cases.push({
          run_id: run.id,
          scenario_index: index,
          scenario_title: scenario.title,
          target_model: target,
          repetition,
        });
      }
    }
  }
  await insert(SAMPLES, cases);

  return run;
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
