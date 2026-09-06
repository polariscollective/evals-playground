// Lire et écrire les runs. Le seul endroit qui connaît la forme des deux tables.
import "server-only";
import { randomUUID } from "node:crypto";
// La matrice se calcule là où on la regarde : l'écran laisse relire un run
// autrement — une médiane, une échelle repliée — et deux calculs de la même
// chose finiraient par ne plus dire pareil.
import { overallMean, progressOf } from "./matrix";
import { catchupCandidateCount } from "./catchup";
import {
  JUDGES,
  JUDGE_SCORES,
  MCP_LAUNCHES,
  NOW,
  RUNS,
  RUN_JUDGES,
  RUN_TAGS,
  SAMPLES,
  SupabaseError,
  failStaleRuns,
  insert,
  remove,
  rpc,
  select,
  update,
} from "./supabase";
import { addEstimates, estimateCost } from "./pricing";
import { estimateExtension } from "./extend-estimate";
import { measureRun, type MeasurableCell } from "./measured-length";
import { cellsForExtension, cellsForRun, coupleKey } from "./cells";
import type { NewCell } from "./cells";
import {
  judgeRowFromSpec,
  judgesForLaunch,
  judgeScoresForSamples,
} from "./launch-judges.ts";
import { classifyRunJudgesRefusal } from "./run-judges-refusal";
import { withoutIdentity } from "./public-run";
import type { PublicRunDetail } from "./public-run";
// `AWAKE_TYPE` : la seule chose qu'on emprunte à `awareness.ts` pour trouver
// la liaison d'éveil d'un run — jamais `findAwakeJudge`, dont la contrainte
// générique (`T extends { system_type: JudgeSystemType | null }`) date d'avant
// le sentinelle et n'accepte donc plus un vrai `RunJudge` (`system_type:
// JudgeSystemTypeColumn`, qui inclut `"ordinary"`, non assignable à
// `JudgeSystemType | null`). Corriger cette contrainte appartient à
// `awareness.ts`, hors du périmètre de cette tâche — voir le rapport.
import { AWAKE_TYPE, type JudgeVerdict } from "./awareness.ts";
import type {
  CostEstimate,
  EvalRun,
  EvalRunConfig,
  EvalSample,
  EvalScenario,
  ExtendRequest,
  Judge,
  JudgeScore,
  JudgeSpec,
  JudgeSystemTypeColumn,
  JudgeVerdictEntry,
  RunDetail,
  RunJudge,
  RunJudgeView,
  RunSummary,
  SampleStatus,
  TemperatureSpec,
  ToolSpec,
} from "./types";

/** Les colonnes d'une case, sauf le transcript.
 *
 * Un transcript pèse plusieurs kilo-octets ; les ramener tous pour compter des
 * statuts ferait passer des mégaoctets par le réseau à chaque rafraîchissement,
 * toutes les trois secondes pendant qu'un run tourne.
 *
 * Depuis les juges multiples, cette liste ne nomme plus `score`,
 * `justification`, `awareness_score`, `awareness_justification` ni
 * `awareness_error` : la migration
 * `20260906093000_drop_eval_samples_score_columns.sql` (dépôt
 * polaris-supabase) les a supprimées d'`eval_samples` — ce que rendait un
 * juge sur une conversation vit désormais dans `judge_scores`, voir
 * `loadLiveRunJudges`, `awarenessMissingTotal` et `loadRuns` plus bas, qui le
 * lisent à part. `error` reste une colonne de `eval_samples` : elle porte
 * l'échec de l'*exécution* de la conversation, jamais celui d'un juge — voir
 * `JudgeScore.error` pour ce second sens, distinct. */
const SAMPLE_COLUMNS =
  "id,run_id,scenario_index,scenario_title,target_model,repetition,status," +
  // `usage` porte les jetons facturés de la case. Petit — cinq compteurs par
  // modèle — et sans commune mesure avec les transcripts, qu'on continue de ne
  // ramener que sur demande. C'est ce qui permet au panneau d'annoncer sur quoi
  // son devis repose, et à `extendRun` de le calculer pareil.
  //
  // `turns_done` dit à quelle profondeur cette case-là a joué, et rien d'autre
  // ne le dit : `config.turns` ne nomme que la dernière demandée. Un run
  // approfondi porte des cases à des profondeurs différentes — sans cette
  // colonne, le panneau les regroupait toutes à la profondeur du run et la
  // mesure divisait chacune par elle.
  "turns_done,temperature,error,started_at,finished_at,cost_usd,usage";

export class NotFound extends Error {}

/** Délier le principal d'un run sans remplaçant valide, alors qu'il reste
 *  d'autres liaisons vivantes sur ce run.
 *
 * Posé par la base, pas par ce fichier — c'est le changement par rapport à
 * une version précédente de ce commentaire, qui décrivait ceci comme un
 * filet posé en application faute d'un tel garde-fou en base. Le déclencheur
 * différé `run_judges_require_principal_trg`
 * (`evals/supabase/migrations/20260906102248_require_run_judges_principal.sql`,
 * dépôt `polaris-supabase`) garantit désormais, au commit, qu'un run ayant au
 * moins une liaison vivante en a toujours exactement une principale.
 * `unlinkJudge` ne fait plus que traduire son message — du français d'une
 * trace serveur vers une phrase anglaise lisible — voir
 * `classifyRunJudgesRefusal`. */
export class PrincipalRequiresReplacement extends Error {}

/** Combien d'essais chaque couple scénario × modèle porte : le moins, le plus.
 *
 * Compté sur les cases plutôt que lu dans `config.repetitions`, qui ne dit que
 * ce qui avait été demandé au dernier lot : un run complété a des couples plus
 * fournis que d'autres, et une moyenne de case porte alors sur moins de
 * conversations que sa voisine.
 *
 * N'exige que deux colonnes — pas `EvalSample` en entier — pour rester
 * satisfait aussi bien par les cases de `loadRuns` (déjà réduites, et
 * augmentées du verdict du principal) que par une `EvalSample` complète. */
function repetitionRange(
  samples: Pick<EvalSample, "scenario_index" | "target_model">[],
): [number, number] {
  const counts = new Map<string, number>();
  for (const sample of samples) {
    const key = coupleKey(sample.scenario_index, sample.target_model);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length === 0) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

/** Une case telle que `loadRuns` la voit : ses coordonnées et son statut
 *  d'exécution, plus le verdict du juge PRINCIPAL — jamais un autre juge, même
 *  règle que `matrix.ts` (voir `MatrixSample`) et pour la même raison :
 *  c'est le juge que la matrice affiche, donc celui dont la moyenne de la
 *  liste des runs doit rendre compte. Un sample sans principal vivant sur son
 *  run (aucun juge, ou tous déliés) porte `{status: "pending", score: null}` :
 *  une absence de juge n'est pas différente, pour cette moyenne, d'un juge qui
 *  n'a pas encore noté. */
interface RunListSample {
  run_id: string;
  status: SampleStatus;
  scenario_index: number;
  target_model: string;
  principal: JudgeVerdict;
}

/** Le verdict du juge PRINCIPAL de chacun de ces runs, par identifiant de
 *  conversation — ce qu'il faut à `overallMean` pour chiffrer la moyenne de
 *  la liste des runs, en une poignée de requêtes plutôt qu'une par run comme
 *  le ferait `loadLiveRunJudges` appelée une fois par run.
 *
 * Filtre `run_judges` sur `deleted_at` et `is_principal` directement, ce qui
 * en fait la seule autre exception, avec `loadLiveRunJudges` elle-même, à la
 * règle que documente cette dernière (« LA fonction... la seule autorisée à
 * filtrer run_judges sur deleted_at »). L'exception est délibérée : cette
 * fonction-là ne sait interroger qu'un run à la fois, et `loadRuns` doit
 * rester quelques requêtes quel que soit le nombre de runs — exactement
 * comme elle l'est déjà pour les cases (voir son commentaire). Le filtre
 * `deleted_at: "is.null"` n'existe donc qu'à deux endroits dans tout le
 * dépôt, à quelques dizaines de lignes l'un de l'autre dans ce même fichier :
 * le risque que ce chantier signale — un oubli dans une troisième copie,
 * ailleurs — reste contenu, il n'y a nulle part d'autre où le réécrire par
 * erreur. */
async function principalVerdictsByRun(
  runIds: string[],
): Promise<Map<string, JudgeVerdict>> {
  if (runIds.length === 0) return new Map();

  const principals = await select<{ id: string }>(RUN_JUDGES, {
    run_id: `in.(${runIds.join(",")})`,
    deleted_at: "is.null",
    is_principal: "eq.true",
    select: "id",
  });
  if (principals.length === 0) return new Map();

  const scores = await select<{
    sample_id: string;
    status: JudgeScore["status"];
    score: number | null;
  }>(JUDGE_SCORES, {
    run_judge_id: `in.(${principals.map((p) => p.id).join(",")})`,
    select: "sample_id,status,score",
  });

  const bySample = new Map<string, JudgeVerdict>();
  for (const row of scores) {
    bySample.set(row.sample_id, { status: row.status, score: row.score });
  }
  return bySample;
}

/** Tous les runs, du plus récent au plus ancien, avec leur avancement.
 *
 * Les cases sont lues en une seule requête pour tous les runs, sans leurs
 * transcripts : les colonnes ramenées sont minuscules, et une requête par run
 * serait bien plus coûteuse. Si la table grossissait au point que ça pèse, une
 * vue d'agrégation en base serait le remède — pas une pagination des cases.
 * Même logique pour le verdict du principal de chaque run, ajouté par
 * `principalVerdictsByRun` en deux requêtes de plus, jamais une par run. */
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
  const samples = await select<
    Pick<EvalSample, "id" | "run_id" | "status" | "scenario_index" | "target_model">
  >(SAMPLES, {
    select: "id,run_id,status,scenario_index,target_model",
  });

  const principals = await principalVerdictsByRun(runs.map((run) => run.id));

  const byRun = new Map<string, RunListSample[]>();
  for (const sample of samples) {
    const enriched: RunListSample = {
      run_id: sample.run_id,
      status: sample.status,
      scenario_index: sample.scenario_index,
      target_model: sample.target_model,
      principal: principals.get(sample.id) ?? { status: "pending", score: null },
    };
    const list = byRun.get(sample.run_id);
    if (list) list.push(enriched);
    else byRun.set(sample.run_id, [enriched]);
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
 * `withTranscripts` ne sert qu'à l'ouverture d'une case, aux exports, et à la
 * lecture publique d'un coup (voir `app/shared/[runId]/page.tsx`) : le
 * rafraîchissement d'un run en cours n'en a pas besoin.
 *
 * `withJudges` attache les juges vivants du run et leurs verdicts (voir
 * `attachJudges`) — sur demande, pas par défaut, pour la même raison que
 * `withAwarenessMissingFlag` avant lui, généralisé ci-dessous en
 * `withCatchupMissingFlag` : la quasi-totalité des appelants de `loadRun` ne
 * l'utilisent jamais. Une douzaine de routes n'appellent cette fonction que
 * pour vérifier qu'un run existe, et les outils MCP demandent explicitement
 * la version légère pour rester légers. Le laisser tourner par défaut pour
 * eux a déjà traîné toute une matrice de conversations hors de la base pour
 * une simple note ou une mise à la corbeille — même risque pour les juges,
 * qui multiplient ce poids par le nombre de juges vivants.
 *
 * `withFullJudgeScores` force le mode complet d'`attachJudges` — les
 * verdicts de TOUS les juges vivants, secondaires compris, pas seulement du
 * principal et de l'éveil — sans exiger `withTranscripts`. Les deux sont
 * normalement demandés ensemble (voir `attachJudges`) parce qu'ouvrir une
 * case ou lire un run publié d'un coup a besoin des deux à la fois ; l'outil
 * MCP `get_run_results` (`app/mcp/route.ts`) est le seul appelant qui a
 * besoin de l'un sans l'autre — rendre le verdict de chaque juge sur chaque
 * case, jamais une conversation. Sans ce champ séparé, lui donner ce dont il
 * a besoin aurait exigé de lui faire porter aussi `withTranscripts`, et donc
 * de rompre la promesse « no transcripts » que sa description tient.
 *
 * Throws:
 *   NotFound: si aucun run ne porte cet identifiant.
 */
export async function loadRun(
  runId: string,
  options: {
    withTranscripts?: boolean;
    withSourceCsvFlag?: boolean;
    withJudges?: boolean;
    withCatchupMissingFlag?: boolean;
    withFullJudgeScores?: boolean;
  } = {},
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
    catchup_missing: await catchupMissingTotal(run, options),
    judges: options.withJudges
      ? await attachJudges(
          runId,
          Boolean(options.withTranscripts) || Boolean(options.withFullJudgeScores),
        )
      : undefined,
  };
}

/** Les juges vivants d'un run, avec leur verdict sur chaque conversation —
 *  ce que `RunDetail.judges` porte à l'écran (voir `RunJudgeView`,
 *  `types.ts`). Passe par `loadLiveRunJudges`, comme tout code qui a besoin
 *  de savoir quels juges sont vivants sur un run : aucun filtre
 *  `deleted_at` de plus n'est écrit ici.
 *
 * `fullScores` décide du poids de cette jointure, sur le même principe que
 * `SAMPLE_COLUMNS`/`withTranscripts` plus haut : les verdicts de N juges sur
 * toutes les conversations d'un run pèsent, eux aussi, plusieurs juges ×
 * plusieurs dizaines de conversations × une justification qui peut faire
 * plusieurs phrases. `false` (le défaut, à chaque rafraîchissement de trois
 * secondes pendant qu'un run tourne) ne ramène les notes que du juge
 * PRINCIPAL et de l'éventuelle liaison d'éveil — les deux seuls que la
 * matrice et son voyant affichent sans qu'on déplie quoi que ce soit. `true`
 * ramène aussi celles des juges secondaires : demandé par `loadRun` dès que
 * `withTranscripts` l'est (ouvrir une case, ou lire un run publié d'un
 * coup — voir `AttemptView`, `components/RunRead.tsx`) OU que
 * `withFullJudgeScores` l'est — voir sa docstring sur `loadRun` pour le seul
 * appelant qui demande l'un sans l'autre : rendre chaque juge sans jamais
 * charger une conversation.
 *
 * Chaque juge vivant apparaît toujours dans le tableau rendu — y compris
 * sans `fullScores`, où un juge secondaire porte alors `scores: {}` — pour
 * que « Show N other judges » compte juste sans avoir à charger leurs notes. */
async function attachJudges(
  runId: string,
  fullScores: boolean,
): Promise<RunJudgeView[]> {
  const live = await loadLiveRunJudges(runId);
  if (live.length === 0) return [];

  const wanted = fullScores
    ? live
    : live.filter(
        (liaison) => liaison.is_principal || liaison.system_type === AWAKE_TYPE,
      );

  const rows =
    wanted.length === 0
      ? []
      : await select<{
          run_judge_id: string;
          sample_id: string;
          status: JudgeScore["status"];
          score: number | null;
          justification: string;
          error: string | null;
        }>(JUDGE_SCORES, {
          run_judge_id: `in.(${wanted.map((liaison) => liaison.id).join(",")})`,
          select: "run_judge_id,sample_id,status,score,justification,error",
        });

  const byJudge = new Map<string, Record<string, JudgeVerdictEntry>>();
  for (const row of rows) {
    const scores = byJudge.get(row.run_judge_id) ?? {};
    scores[row.sample_id] = {
      status: row.status,
      score: row.score,
      justification: row.justification,
      error: row.error,
    };
    byJudge.set(row.run_judge_id, scores);
  }

  return live.map((liaison) => ({
    run_judge_id: liaison.id,
    judge: liaison.judge,
    is_principal: liaison.is_principal,
    system_type: liaison.system_type,
    scores: byJudge.get(liaison.id) ?? {},
  }));
}

/** Combien de lignes de `judge_scores`, en attente sur une liaison vivante,
 *  portent sur une conversation déjà terminée — donc ce que le prochain
 *  rattrapage va réellement remplir. Généralise l'ancienne
 *  `awarenessMissingTotal` (jusqu'aux juges multiples, seule la liaison
 *  d'éveil pouvait porter des lignes en attente après coup) à n'importe quel
 *  juge vivant — voir la conception, section « Le rattrapage, généralisé ».
 *
 * Sur demande, jamais par défaut, même raison que l'ancienne version : la
 * quasi-totalité des appelants de `loadRun` ne l'utilisent jamais.
 *
 * LE PIÈGE, et il a déjà mordu ce chantier une fois sur l'éveil : une ligne
 * en attente sur une liaison vivante n'est pas forcément rattrapable — sa
 * conversation doit AUSSI être terminée (`status = 'done'`). Le moteur
 * (`catchup_dataset`, `backend/playground/batch_job.py`) applique ces trois
 * conditions ensemble et ne rattrape jamais une conversation qui ne l'est
 * pas ; un compte qui ignorerait la troisième annoncerait du travail que le
 * moteur ne fera jamais, et le bouton resterait allumé pour toujours. La
 * troisième condition est vérifiée ici par `catchupCandidateCount`
 * (`catchup.ts`), qui documente ce piège en détail — jamais recomptée à la
 * main ailleurs : la route qui démarre un rattrapage
 * (`.../catchup/route.ts`) relit ce même champ plutôt que de refaire le
 * calcul de son côté, ce qui fait de cette fonction-ci le seul endroit du
 * dépôt qui décide « combien reste-t-il à rattraper ».
 *
 * Deux cas déjà connus restent : le run tourne encore, auquel cas le nombre
 * ne sert à rien puisque le bouton qui le lit exige `!running` — l'annoncer
 * à zéro évite une lecture à chaque rafraîchissement de trois secondes ;
 * aucune liaison vivante ne rend zéro aussi, faute de quoi que ce soit qui
 * puisse manquer. */
async function catchupMissingTotal(
  run: EvalRun,
  options: { withCatchupMissingFlag?: boolean },
): Promise<number> {
  if (!options.withCatchupMissingFlag) return 0;
  if (run.status === "triggered" || run.status === "running") return 0;

  const live = await loadLiveRunJudges(run.id);
  if (live.length === 0) return 0;

  const pending = await select<{ sample_id: string }>(JUDGE_SCORES, {
    run_id: `eq.${run.id}`,
    run_judge_id: `in.(${live.map((liaison) => liaison.id).join(",")})`,
    status: "eq.pending",
    select: "sample_id",
  });
  if (pending.length === 0) return 0;

  const sampleIds = [...new Set(pending.map((row) => row.sample_id))];
  const done = await select<{ id: string }>(SAMPLES, {
    run_id: `eq.${run.id}`,
    id: `in.(${sampleIds.join(",")})`,
    status: "eq.done",
    select: "id",
  });

  return catchupCandidateCount(pending, new Set(done.map((row) => row.id)));
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
  //
  // `returning: true` : les identifiants des cases sont nécessaires juste en
  // dessous pour poser les lignes de `judge_scores`, qui visent une
  // conversation par son `id` et non par son quadruplet.
  const samples = await insert<{ id: string }>(
    SAMPLES,
    cellsForRun(config).map((cell) => ({ run_id: run.id, ...cell })),
    { returning: true },
  );

  // Les juges du run, et toutes leurs lignes de score en attente — même
  // geste que la matrice ci-dessus : rien n'est inventé plus tard, tout
  // existe déjà, en pending. Trois inserts dans cet ordre précisément parce
  // que chacune des tables suivantes porte une clé étrangère vers la
  // précédente : judges avant run_judges, run_judges (et les échantillons,
  // déjà en base) avant judge_scores.
  const { judges, runJudges, judgeScores } = judgesForLaunch(
    config,
    run.id,
    userEmail,
    samples.map((sample) => sample.id),
  );
  await insert(JUDGES, judges);
  await insert(RUN_JUDGES, runJudges);
  await insert(JUDGE_SCORES, judgeScores);

  return run;
}

// --- les juges -----------------------------------------------------------

/** Une liaison vivante, avec le juge qu'elle vise déjà résolu — ce qu'un
 *  appelant a besoin de savoir pour afficher, exporter, ou noter au nom de ce
 *  juge, sans jamais relire `judges` à côté. */
export interface LiveRunJudge extends RunJudge {
  judge: Judge;
}

/** LA fonction qui charge les juges d'un run — la seule autorisée à filtrer
 *  `run_judges` sur `deleted_at`, avec l'exception ci-dessous. Tout code qui a
 *  besoin de savoir quels juges sont vivants sur un run — l'écran, un export,
 *  un outil MCP, le devis, la configuration renvoyée à un agent — appelle
 *  celle-ci ; rien d'autre dans ce dépôt n'a le droit de relire `run_judges`
 *  par un `select` direct.
 *
 * Recopié dans deux lectures, ce filtre serait oublié dans une troisième :
 * ce chantier a déjà produit deux exemples réels de cet oubli — un compte qui
 * alourdissait douze routes qu'on n'avait pas vues, un formulaire qui
 * ignorait un champ pendant tout un plan (voir la conception,
 * docs/superpowers/specs/2026-09-06-juges-multiples.md). Un juge délié ne
 * doit plus jamais ressortir nulle part ; le seul moyen de le garantir est
 * qu'il n'y ait qu'un seul endroit à vérifier. Tout code qui a besoin de
 * savoir quels juges sont vivants sur un run passe par elle plutôt que de
 * relire `run_judges` à sa façon — `unlinkJudge` et `designatePrincipal`,
 * juste en dessous, n'en font plus partie : ils délèguent désormais ce
 * même filtre aux fonctions RPC qui portent leur geste en base, en une
 * transaction (voir leurs commentaires).
 *
 * L'UNE exception, delibérée : `principalVerdictsByRun`, plus bas dans ce
 * même fichier, filtre `run_judges` sur `deleted_at` elle aussi, mais en vrac
 * pour plusieurs runs à la fois — ce que cette fonction-ci, prenant un seul
 * `runId`, ne sait pas faire sans devenir un appel par run dans `loadRuns`.
 * Les deux copies du filtre vivent à quelques dizaines de lignes l'une de
 * l'autre, dans ce même fichier : le risque d'oubli que ce commentaire décrit
 * reste contenu, faute d'un troisième endroit où le réécrire par erreur. */
export async function loadLiveRunJudges(runId: string): Promise<LiveRunJudge[]> {
  const liaisons = await select<RunJudge>(RUN_JUDGES, {
    run_id: `eq.${runId}`,
    // Le seul endroit du dépôt qui filtre sur deleted_at pour cette table.
    deleted_at: "is.null",
    select: "*",
    order: "created_at.asc",
  });
  if (liaisons.length === 0) return [];

  const judgeIds = [...new Set(liaisons.map((liaison) => liaison.judge_id))];
  const judges = await select<Judge>(JUDGES, {
    id: `in.(${judgeIds.join(",")})`,
    select: "*",
  });
  const byId = new Map(judges.map((judge) => [judge.id, judge]));

  return liaisons.map((liaison) => {
    const judge = byId.get(liaison.judge_id);
    if (!judge) {
      // Ne devrait jamais arriver : la clé étrangère composée
      // `run_judges_judge_fk` garantit qu'un `judge_id` de `run_judges`
      // existe toujours dans `judges`. Une base qui viole sa propre
      // contrainte mérite un échec bruyant, pas une liaison sans juge.
      throw new SupabaseError(
        `run_judges ${liaison.id} references unknown judge ${liaison.judge_id}`,
      );
    }
    return { ...liaison, judge };
  });
}

/** Le juge et son verdict, pour une liaison vivante d'un run — ce que
 *  `judgeVerdictsForSample`, juste en dessous, rend pour CHACUNE. */
export interface SampleJudgeVerdict {
  judge: Judge;
  is_principal: boolean;
  system_type: JudgeSystemTypeColumn;
  verdict: JudgeVerdictEntry;
}

/** Le verdict de chaque juge vivant d'un run sur UNE conversation choisie —
 *  ce qu'il faut à l'outil MCP `get_run_trajectory` pour montrer le verdict
 *  de chacun sur une seule case, sans charger tout le run comme le ferait
 *  `attachJudges` : une ligne de `judge_scores` par juge vivant, jamais une
 *  par conversation du run entier. Passe par `loadLiveRunJudges`, comme tout
 *  code qui a besoin de savoir quels juges sont vivants sur un run — un juge
 *  délié ne doit jamais apparaître ici non plus.
 *
 * Une liaison sans ligne pour ce `sampleId` — ne devrait pas arriver, voir la
 * conception, section « Les lignes de score sont créées d'avance » — rend son
 * attente par défaut plutôt que de disparaître de la liste : chaque juge
 * vivant apparaît toujours, exactement comme `attachJudges` le fait déjà pour
 * un run entier. */
export async function judgeVerdictsForSample(
  runId: string,
  sampleId: string,
): Promise<SampleJudgeVerdict[]> {
  const live = await loadLiveRunJudges(runId);
  if (live.length === 0) return [];

  const rows = await select<{
    run_judge_id: string;
    status: JudgeScore["status"];
    score: number | null;
    justification: string;
    error: string | null;
  }>(JUDGE_SCORES, {
    run_judge_id: `in.(${live.map((liaison) => liaison.id).join(",")})`,
    sample_id: `eq.${sampleId}`,
    select: "run_judge_id,status,score,justification,error",
  });
  const byJudge = new Map(rows.map((row) => [row.run_judge_id, row]));

  return live.map((liaison) => ({
    judge: liaison.judge,
    is_principal: liaison.is_principal,
    system_type: liaison.system_type,
    verdict: byJudge.get(liaison.id) ?? {
      status: "pending",
      score: null,
      justification: "",
      error: null,
    },
  }));
}

/** Traduit un refus de `run_judges_unlink` ou `run_judges_transfer_principal`
 *  — ou du déclencheur différé qui les couvre — en l'erreur que ces deux
 *  fonctions exposent déjà, avec un message anglais lisible. Toute erreur
 *  qui n'est pas un refus reconnu de ces fonctions (`SupabaseError` sans
 *  correspondance, ou une erreur d'une autre nature) traverse telle quelle :
 *  mieux vaut un message imparfait que d'en avaler un qu'on n'a pas su lire.
 *
 * Le classement lui-même — reconnaître le texte français que Postgres rend —
 * vit dans `run-judges-refusal.ts`, à part de ce fichier, pour rester
 * testable sans Supabase (voir son commentaire). Cette fonction-ci ne fait
 * que choisir, selon le classement, laquelle des classes d'erreur de ce
 * fichier lever.
 */
function throwRunJudgesRefusal(error: unknown): never {
  if (error instanceof SupabaseError) {
    const refusal = classifyRunJudgesRefusal(error.message);
    if (refusal) {
      if (refusal.kind === "principal_needs_replacement") {
        throw new PrincipalRequiresReplacement(refusal.message);
      }
      if (refusal.kind === "not_found") throw new NotFound(refusal.message);
      throw new Error(refusal.message);
    }
  }
  throw error;
}

/** Délie un juge d'un run : marque sa liaison supprimée, sans toucher au
 *  juge — une configuration qui peut resservir — ni à `judge_scores`, qui
 *  disparaît en cascade avec la liaison (voir le commentaire de la
 *  migration sur `run_judges.deleted_at`).
 *
 * Passe par la fonction RPC `run_judges_unlink`, qui délie et — si
 * `replacementRunJudgeId` est fourni et que `runJudgeId` porte le principal —
 * transfère le principal au remplaçant, en une seule transaction.
 *
 * **Pourquoi une fonction en base, et non deux écritures** : PostgREST fait
 * un aller-retour par écriture, donc une transaction par écriture. Poser
 * `deleted_at` sur le principal comme écriture séparée de celle qui
 * désignerait son remplaçant laisserait, la première validée seule, un run
 * sans aucun principal — ce que le déclencheur différé
 * `run_judges_require_principal_trg` refuse désormais à son propre commit
 * (voir `PrincipalRequiresReplacement`). Deux écritures redeviendraient donc
 * un aller simple qui échoue toujours dès qu'il reste d'autres juges vivants
 * sur le run. Voir .superpowers/sdd/fix-principal-rpc-report.md pour le SQL
 * exact des deux fonctions RPC et ce que chaque refus signifie.
 *
 * Sans `replacementRunJudgeId` : délier une liaison qui n'est pas principale
 * ne pose aucune question. Délier la dernière liaison vivante du run est
 * permis aussi — un run sans aucun juge est un état valide. Délier le
 * principal alors qu'il reste d'autres liaisons vivantes, sans remplaçant,
 * est refusé par le déclencheur différé cité plus haut ; ce n'est plus ce
 * fichier qui recompte les liaisons pour l'anticiper.
 *
 * Throws:
 *   NotFound: si `runJudgeId` (ou le remplaçant fourni) ne désigne aucune
 *     liaison de ce run, ou en désigne une déjà déliée.
 *   PrincipalRequiresReplacement: si `runJudgeId` est le principal vivant du
 *     run, qu'aucun remplaçant valide n'est fourni, et qu'il reste d'autres
 *     liaisons vivantes sur ce run.
 */
export async function unlinkJudge(
  runId: string,
  runJudgeId: string,
  replacementRunJudgeId: string | null = null,
): Promise<void> {
  try {
    await rpc("run_judges_unlink", {
      p_run_id: runId,
      p_run_judge_id: runJudgeId,
      p_replacement_run_judge_id: replacementRunJudgeId,
    });
  } catch (error) {
    throwRunJudgesRefusal(error);
  }
}

/** Désigne le principal d'un run : celui que la matrice affiche.
 *
 * Passe par la fonction RPC `run_judges_transfer_principal`, qui retire
 * `is_principal` à l'ancien principal vivant, s'il y en a un, et le pose sur
 * `runJudgeId` — dans cet ordre, jamais l'inverse — en une seule transaction.
 * L'ordre importe pour la même raison qu'avant : poser le nouveau principal
 * avant de retirer l'ancien ferait cohabiter, l'instant d'un aller-retour,
 * deux liaisons vivantes principales pour le même run, ce que l'index unique
 * partiel `run_judges_single_principal_idx` refuse. Voir le commentaire
 * d'`unlinkJudge` pour pourquoi c'est désormais la fonction RPC, et non ce
 * fichier en deux écritures, qui tient cet ordre.
 *
 * Idempotent : désigner un juge déjà principal ne réécrit rien — c'est la
 * fonction RPC elle-même qui le garantit, pas une vérification ici.
 *
 * Throws:
 *   NotFound: si `runJudgeId` ne désigne aucune liaison vivante de ce run.
 */
export async function designatePrincipal(runId: string, runJudgeId: string): Promise<void> {
  try {
    await rpc("run_judges_transfer_principal", {
      p_run_id: runId,
      p_run_judge_id: runJudgeId,
    });
  } catch (error) {
    throwRunJudgesRefusal(error);
  }
}

/** Ce qu'un appelant a lancé par MCP sur l'heure qui vient de s'écouler : le
 *  nombre de lancements, et leur devis additionné — jamais ce qu'un run a
 *  fini par coûter réellement, qui n'existe qu'une fois celui-ci terminé et
 *  qu'un agent ne peut donc jamais prévoir avant d'appeler.
 *
 * Compté sur `mcp_launches`, pas sur `eval_runs` : une extension écrit sur un
 * run existant, qui peut avoir été créé par un humain ou déjà porter les
 * lancements de plusieurs agents différents — `eval_runs.launched_via` ne
 * répond plus à « combien tel appelant a-t-il dépensé », seulement à « ce run
 * a-t-il été démarré par un agent ». `mcp_launches` porte une ligne par
 * lancement et non par run, ce qui rend une extension comptable exactement
 * comme un run neuf. Filtré sur `user_email` et `created_at` : la lecture que
 * couvre l'index posé avec la table.
 *
 * Le compte sert la page de profil, le montant sert aussi la décision de
 * budget de `app/mcp/route.ts` — voir `mcpSpendLastHour`, qui n'en garde que
 * le second pour ne pas changer la forme attendue là où le compte ne sert à
 * rien. */
export async function mcpActivityLastHour(
  userEmail: string,
): Promise<{ count: number; usd: number }> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const launches = await select<{ quoted_usd: number }>(MCP_LAUNCHES, {
    select: "quoted_usd",
    user_email: `eq.${userEmail}`,
    created_at: `gte.${since}`,
  });
  return {
    count: launches.length,
    usd: launches.reduce((total, launch) => total + launch.quoted_usd, 0),
  };
}

/** Le seul chiffre dont la décision de budget a besoin — voir
 *  `mcpActivityLastHour` pour ce qui est compté et pourquoi. */
export async function mcpSpendLastHour(userEmail: string): Promise<number> {
  return (await mcpActivityLastHour(userEmail)).usd;
}

/** Enregistre un lancement réussi par MCP, `run` comme `extend`.
 *
 * À appeler après que le job a réellement démarré, jamais avant : une ligne
 * pour un lancement qui n'a pas eu lieu consommerait un budget pour rien.
 * `quotedUsd` est le devis qui a servi à décider du lancement — celui vérifié
 * contre les deux plafonds — et non un coût recalculé après coup : c'est lui
 * qui fait foi, voir `mcpSpendLastHour`. */
export async function recordLaunch(
  userEmail: string,
  runId: string,
  kind: "run" | "extend",
  quotedUsd: number,
): Promise<void> {
  await insert(MCP_LAUNCHES, {
    user_email: userEmail,
    run_id: runId,
    kind,
    quoted_usd: quotedUsd,
  });
}

/** Ouvre une passe de rattrapage sur un run.
 *
 * Ne remet RIEN en attente, contrairement à `extendRun` : les lignes à
 * remplir existent déjà, en `pending`, depuis le lancement, une extension,
 * ou l'ajout d'un juge (`addJudge`, juste en dessous) — ce que ce rattrapage
 * vient combler, pas refaire. Seul le run repasse en `running`, pour que
 * l'écran montre qu'il se passe quelque chose.
 *
 * Remplace l'ancien `resetForRejudge` et l'ancien `startAwarenessPass` : le
 * premier écrasait le verdict du principal avant de refaire — « rejuger »
 * n'existe plus, voir `addJudge` pour ce que ce geste est devenu — et le
 * second ne rattrapait que la liaison d'éveil. Un seul mode dans le job
 * (`catchup`, voir `run_batch_job`, `backend/playground/batch_job.py`) pour
 * les deux, généralisé à n'importe quel juge — voir
 * `.superpowers/sdd/task-9-report.md`. */
export async function startCatchupPass(runId: string): Promise<void> {
  await update(
    RUNS,
    { status: "running", error: null, started_at: NOW, finished_at: null },
    { id: `eq.${runId}` },
  );
}

/** Ajoute un juge secondaire à un run existant : le juge, sa liaison —
 *  jamais principale — et une ligne de `judge_scores` en attente sur CHAQUE
 *  conversation déjà posée pour ce run, jouée ou non.
 *
 * C'est ce que « rejuger » est devenu depuis les juges multiples : on
 * n'écrase plus le verdict du principal, on ajoute un juge de plus, et
 * l'ancien reste pour comparer — voir `.superpowers/sdd/task-9-report.md`.
 *
 * Sans ces lignes de `judge_scores`, `write_judge_score` (moteur,
 * `supabase_store.py`) ne trouverait rien à mettre à jour : elle ne fait
 * qu'un UPDATE ciblé sur (`run_judge_id`, `sample_id`), jamais un INSERT —
 * voir le commentaire de `judgeScoresForSamples`. Ce défaut a déjà existé
 * une fois, sur l'extension de run (`extendRun`), avant d'être corrigé ; il
 * ne doit pas se répéter ici. `startCatchupPass`, plus haut, est ce qui
 * remplit ensuite ces lignes pour les conversations déjà terminées — voir
 * `catchupMissingTotal` pour comment ce qui reste à rattraper se compte.
 *
 * Toujours secondaire (`is_principal: false`) : désigner un juge principal
 * dès sa création confondrait deux gestes distincts, voir `designatePrincipal`
 * pour le second, séparé et explicite.
 *
 * `createdBy` vient de la session de l'appelant, jamais du corps de la
 * requête — même règle que partout ailleurs dans ce fichier.
 *
 * Throws:
 *   NotFound: si aucun run ne porte cet identifiant.
 */
export async function addJudge(
  runId: string,
  spec: JudgeSpec,
  createdBy: string,
): Promise<{ runJudgeId: string }> {
  const runs = await select<{ id: string; config: EvalRunConfig }>(RUNS, {
    id: `eq.${runId}`,
    select: "id,config",
    deleted_at: "is.null",
    limit: 1,
  });
  if (runs.length === 0) throw new NotFound(`Unknown run: ${runId}`);
  const run = runs[0];

  // Toutes les conversations déjà posées, terminées ou non : une case encore
  // `pending`/`running` recevra sa ligne de score comme les autres — voir la
  // docstring pour pourquoi une ligne en attente doit exister d'avance,
  // quel que soit l'état de la case qu'elle vise.
  const samples = await select<{ id: string }>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: "id",
  });

  const judge = judgeRowFromSpec(spec, run.config.models.judge, createdBy);
  const runJudgeId = randomUUID();

  await insert(JUDGES, judge);
  await insert(RUN_JUDGES, {
    id: runJudgeId,
    run_id: runId,
    judge_id: judge.id,
    system_type: judge.system_type,
    is_principal: false,
  });
  if (samples.length > 0) {
    await insert(
      JUDGE_SCORES,
      judgeScoresForSamples(runId, [runJudgeId], samples.map((sample) => sample.id)),
    );
  }

  return { runJudgeId };
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
 * Ne touche jamais `judge_scores`, à la différence de l'approfondissement
 * dans `extendRun` : une case en `error` a échoué à
 * l'*exécution*, avant qu'aucun juge n'ait pu la voir — voir la distinction
 * portée par `EvalSample.error` dans `types.ts`. Ses lignes de score
 * attendent donc toujours en `"pending"`, posées dès le lancement, jamais
 * atteintes ; il n'y a rien à y remettre.
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

/** Ce qu'une extension ajoute et coûte, réduit à ce qu'`extendRun` et la route
 *  MCP en font — voir `planExtension` juste en dessous. */
export interface ExtensionPlan {
  run: EvalRun;
  /** Tous les scénarios du run après l'extension, anciens et nouveaux — pour
   *  réécrire `config.scenarios`. */
  scenarios: EvalScenario[];
  /** Les modèles cibles du run après l'extension — pour réécrire
   *  `config.models.targets`. */
  targets: string[];
  temperature: TemperatureSpec | null | undefined;
  /** Les outils du run après l'extension — pour réécrire `config.tools`. */
  tools: ToolSpec[];
  /** Les cases neuves à écrire, déjà numérotées sur ce qui existe en base.
   *  Vide quand l'extension n'ajoute rien — un approfondissement seul, ou
   *  rien du tout. */
  cases: NewCell[];
  /** Combien d'essais déjà joués elle remet en jeu pour être approfondis. */
  continuées: number;
  /** Les identifiants de ces mêmes essais — `continuées` n'en est que la
   *  longueur. `extendRun` en a besoin pour remettre en attente, sur
   *  `judge_scores`, le verdict de CHAQUE juge vivant du run sur ces
   *  conversations : un verdict portait sur une conversation plus courte, et
   *  ne dit rien de celle qui vient (voir le commentaire d'`extendRun`).
   *  Vide quand `continuées` vaut zéro. */
  continuedSampleIds: string[];
  /** `null` quand `cases` est vide et `continuées` vaut zéro : il n'y a alors
   *  rien à chiffrer. */
  estimate: CostEstimate | null;
}

/** Ce qu'une extension va ajouter et coûter, lu sans rien écrire.
 *
 * Sert deux appelants qui doivent tomber sur le même chiffre : `extendRun`,
 * qui insère `cases` telles quelles et n'a plus à les reconstruire, et la
 * route MCP, qui lit `estimate` pour décider si le devis passe sous les deux
 * plafonds *avant* d'écrire quoi que ce soit. Un devis calculé chacun de son
 * côté avait déjà divergé d'un facteur trois — la raison d'être de ce fichier
 * tient dans `extend-estimate.ts` — et la même dérive guettait la forme même
 * de l'extension, jusqu'aux cases elles-mêmes : les compter par un produit à
 * côté de `cellsForExtension`, plutôt que de l'appeler, aurait rouvert
 * exactement ce risque le jour où l'une des deux formes changerait sans
 * l'autre. Il n'y a donc qu'un seul endroit qui les construit.
 *
 * Ne fait aucune écriture.
 *
 * Throws:
 *   NotFound: si aucun run ne porte cet identifiant.
 */
export async function planExtension(
  runId: string,
  request: ExtendRequest,
): Promise<ExtensionPlan> {
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

  // Les essais retenus pour l'approfondissement : notés par le juge PRINCIPAL
  // — jamais un autre juge du run — et, quand une liste de notes est donnée,
  // parmi celles-là. Même choix que pour la matrice et le compte
  // d'approfondissement (`matrix.ts`, `deepen-counts.ts`) : c'est déjà le
  // juge que la matrice affiche, et « les essais notés 0 ou 1 » n'a plus de
  // référent unique dès qu'un run porte plusieurs juges — il fallait en
  // choisir un, et c'est celui-là qui a déjà été choisi ailleurs pour la même
  // question. `score=in.(...)` exclut déjà les essais sans note, une liste de
  // nombres ne contenant jamais `null` ; `not.is.null` fait ce travail pour
  // "all". Un run sans principal vivant (aucun juge, ou tous déliés) n'a rien
  // à approfondir : `principal` vaut alors `undefined`.
  const principal = (await loadLiveRunJudges(runId)).find(
    (judge) => judge.is_principal,
  );
  const àContinuer =
    request.deepen === undefined || !principal
      ? []
      : await deepenCandidates(runId, principal.id, request.deepen);
  // Une extension qui n'approfondit que des essais existants n'ajoute aucune
  // case neuve ; ce n'est pas pour autant qu'il n'y a rien à faire.
  const continuedSampleIds = àContinuer.map((sample) => sample.id);
  const continuées = àContinuer.length;
  if (cases.length === 0 && continuées === 0) {
    return {
      run,
      scenarios,
      targets,
      temperature,
      tools: outils,
      cases,
      continuées: 0,
      continuedSampleIds: [],
      estimate: null,
    };
  }

  // Ce que le run sait de lui-même. Cinq colonnes seulement : les transcripts
  // pèsent des centaines de kilo-octets et la mesure n'en a pas besoin,
  // `usage` portant les jetons réellement facturés et `turns_done` la
  // profondeur à laquelle chaque case les a dépensés.
  const jouees = await select<MeasurableCell>(SAMPLES, {
    run_id: `eq.${runId}`,
    select: "scenario_index,target_model,status,turns_done,usage",
  });
  for (const cell of jouees) cell.usage ??= {};
  const mesure = measureRun(jouees, config.models, config.turns);

  // Les scénarios réellement ajoutés, chacun avec son index dans le run : un
  // décalage donnerait à un scénario la longueur mesurée d'un autre, en
  // silence.
  const retenus = indices
    .filter((index) => Boolean(scenarios[index]))
    .map((index) => ({ index, scenario: scenarios[index] }));

  // Le calcul lui-même est celui du panneau, à la lettre : `estimateExtension`
  // est appelée ici, et par le panneau côté client. Deux calculs séparés
  // avaient divergé d'un facteur trois sans que rien ne le dise.
  const estimate = estimateExtension(
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

  return {
    run,
    scenarios,
    targets,
    temperature,
    tools: outils,
    cases,
    continuées,
    continuedSampleIds,
    estimate,
  };
}

/** Les essais qu'un approfondissement retient : notés par la liaison
 *  `run_judge_id` donnée (le principal, voir l'appelant), et — quand une
 *  liste de notes est fournie — parmi celles-là.
 *
 * Deux requêtes plutôt qu'une : `judge_scores` ne porte ni `target_model` ni
 * `turns_done`, qu'il faut pourtant à `estimateExtension`
 * (`groupByModelAndDepth`, dans `deepen-counts.ts`) pour chiffrer par couple
 * (modèle, profondeur de départ) — et à `extendRun` pour retrouver ces mêmes
 * essais par leur identifiant. Pas de jointure possible en une seule requête
 * PostgREST au travers de ce client minimal (voir `supabase.ts`), qui ne
 * connaît qu'une table à la fois par appel. */
async function deepenCandidates(
  runId: string,
  principalRunJudgeId: string,
  deepen: "all" | number[],
): Promise<{ id: string; target_model: string; turns_done: number | null }[]> {
  const scored = await select<{ sample_id: string }>(JUDGE_SCORES, {
    select: "sample_id",
    run_judge_id: `eq.${principalRunJudgeId}`,
    status: "eq.done",
    score: Array.isArray(deepen) ? `in.(${deepen.join(",")})` : "not.is.null",
  });
  if (scored.length === 0) return [];

  return select<{ id: string; target_model: string; turns_done: number | null }>(
    SAMPLES,
    {
      select: "id,target_model,turns_done",
      run_id: `eq.${runId}`,
      id: `in.(${scored.map((row) => row.sample_id).join(",")})`,
    },
  );
}

/** Ajoute une sous-matrice à un run existant.
 *
 * Les cases déjà notées ne sont pas touchées : seules les nouvelles naissent en
 * `pending`, et le job ne déroule que celles-là. Les répétitions ajoutées
 * continuent la numérotation de leur couple plutôt que de repartir de zéro, ce
 * qui est aussi ce qui empêche la contrainte d'unicité de refuser l'insertion.
 *
 * Ce que l'extension ajoute et coûte est décidé par `planExtension`, appelée
 * ici comme depuis la route MCP qui vérifie un devis avant de lancer : voir
 * sa documentation pour pourquoi les deux ne doivent pas le recalculer chacun
 * à sa façon.
 *
 * `by` et `via` ne se devinent pas ici : ce sont les deux appelants — la route
 * web et l'outil MCP `launch_draft` — qui savent qui demande et par quelle
 * porte. Une entrée est posée dans `eval_runs.extensions` pour toute extension
 * qui ajoute ou approfondit réellement quelque chose, avec le coût du run tel
 * qu'il était juste avant — voir `RunExtensionLogEntry` et, pour le coût réel
 * qui s'en déduit, `run-extensions.ts`.
 *
 * Deux gestes sur `judge_scores`, en plus des cases elles-mêmes, tous deux
 * nécessaires depuis les juges multiples et absents avant cette fonction :
 * - les cases neuves n'ont, à leur naissance, aucune ligne de score pour
 *   aucun juge — `write_judge_score` (moteur, `supabase_store.py`) ne fait
 *   qu'un `UPDATE` ciblé, jamais un `INSERT` ; sans lignes précréées ici, en
 *   `pending`, tout verdict sur une case neuve se perdrait en silence (voir
 *   `judgeScoresForSamples`, `launch-judges.ts`) ;
 * - les essais approfondis gardent, sur `judge_scores`, le verdict de TOUS
 *   les juges vivants du run sur leur conversation d'avant, plus courte : il
 *   faut les remettre en attente, pas seulement celui du principal qui a
 *   servi à les choisir (voir `planExtension`) — un juge secondaire qui
 *   garderait son ancien verdict le laisserait engagé sur un texte qui n'est
 *   plus la conversation jugée.
 *
 * Renvoie le nombre de cases ajoutées, plus celles remises en attente pour
 * être continuées. */
export async function extendRun(
  runId: string,
  request: ExtendRequest,
  by: string,
  via: "ui" | "mcp",
): Promise<number> {
  const {
    run,
    scenarios,
    targets,
    temperature,
    tools: outils,
    cases,
    continuées,
    continuedSampleIds,
    estimate: ajout,
  } = await planExtension(runId, request);
  if (cases.length === 0 && continuées === 0) return 0;

  const config = run.config;

  // L'entrée d'historique rejoint l'écriture de la configuration plutôt que
  // d'ouvrir une requête à part : les deux décrivent le run lui-même, et une
  // panne qui laisserait l'une sans l'autre — `turns` déjà avancé sans que
  // rien n'en dise la raison, ou l'inverse — serait la moitié d'un
  // renseignement. `cost_before_usd` est celui lu par `planExtension` plus
  // haut, donc rigoureusement celui d'avant cette écriture.
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
      extensions: [
        ...run.extensions,
        {
          at: new Date().toISOString(),
          by,
          via,
          request,
          estimate: ajout,
          cost_before_usd: run.cost_usd,
        },
      ],
      status: "triggered",
      error: null,
      finished_at: null,
    },
    { id: `eq.${runId}` },
  );

  // `returning: true` : il faut les identifiants réels des cases neuves —
  // générés en base, `NewCell` n'en porte pas — pour leur poser des lignes de
  // `judge_scores`, juste en dessous.
  const inserted = await insert<{ id: string }>(
    SAMPLES,
    cases.map((cell) => ({ run_id: runId, ...cell })),
    { returning: true },
  );

  // Les juges vivants du run, dont ni les cases neuves ni les essais
  // approfondis n'ont encore de ligne de score à jour — voir le commentaire
  // de tête de cette fonction pour les deux raisons, différentes, qui
  // l'exigent des deux côtés. Une seule lecture pour les deux gestes.
  const liveJudgeIds =
    inserted.length > 0 || continuedSampleIds.length > 0
      ? (await loadLiveRunJudges(runId)).map((judge) => judge.id)
      : [];

  if (inserted.length > 0 && liveJudgeIds.length > 0) {
    await insert(
      JUDGE_SCORES,
      judgeScoresForSamples(
        runId,
        liveJudgeIds,
        inserted.map((sample) => sample.id),
      ),
    );
  }

  // Les essais à continuer repartent en attente en gardant leur conversation :
  // c'est ce couple — `pending` avec des `messages` — qui dit au moteur de
  // continuer plutôt que de rejouer. `turns_done` ne bouge pas : c'est lui,
  // comparé à `config.turns` déjà écrit ci-dessus, qui distinguera un essai à
  // poursuivre d'un essai déjà à sa profondeur.
  if (continuedSampleIds.length > 0) {
    await update(
      SAMPLES,
      { status: "pending", error: null, finished_at: null },
      { id: `in.(${continuedSampleIds.join(",")})` },
    );

    // Leur verdict part maintenant, pas après — sur `judge_scores`, tous les
    // juges vivants du run compris, pas seulement le principal qui a servi à
    // les choisir (voir `planExtension`). Il portait sur une conversation
    // plus courte et ne dit rien de celle qui vient ; une panne en cours de
    // route doit laisser un essai sans verdict plutôt qu'un essai portant un
    // verdict qui ne correspond plus.
    if (liveJudgeIds.length > 0) {
      await update(
        JUDGE_SCORES,
        { status: "pending", score: null, justification: "", error: null },
        {
          run_judge_id: `in.(${liveJudgeIds.join(",")})`,
          sample_id: `in.(${continuedSampleIds.join(",")})`,
        },
      );
    }
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
  options: { withTranscripts?: boolean; withJudges?: boolean } = {},
): Promise<PublicRunDetail> {
  // Le bouton qui lit `source_csv_available` n'existe que sur la page privée,
  // et l'inconnu qui lit une page publiée n'a rien à en faire — d'où l'exclure
  // explicitement ici. Le compte de rattrapage n'a pas besoin du même geste :
  // il est déjà sur demande par défaut (voir `catchupMissingTotal`), et cette
  // route ne le demande jamais — il n'y a aucun bouton d'écriture ici.
  // `withJudges` traverse tel quel : `withoutIdentity`, plus bas, retire
  // `created_by` de chaque juge avant que ça ne sorte.
  const detail = await loadRun(runId, {
    ...options,
    withSourceCsvFlag: false,
  });
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
