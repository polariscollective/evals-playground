// Les lignes des trois tables de juges, à créer pour un run neuf.
//
// Séparé de `runs.ts` pour la même raison que `cells.ts` : c'est la seule
// partie de ce mécanisme qui mérite d'être éprouvée seule — le reste n'est
// que des écritures Supabase — et `runs.ts` importe `server-only`, qui casse
// l'import sous `node --test`. Voir le commentaire en tête de `cells.ts`.
import { randomUUID } from "node:crypto";
import type { EvalRunConfig, JudgeSystemTypeColumn, RubricLevel } from "./types";

/** Une ligne de `judges` telle qu'elle naît, avant insertion. */
export interface NewJudgeRow {
  id: string;
  criterion: string | null;
  rubric: RubricLevel[] | null;
  model: string;
  system_type: JudgeSystemTypeColumn;
  created_by: string;
}

/** Une ligne de `run_judges` telle qu'elle naît, avant insertion.
 *
 * `system_type` copie fidèlement celui du juge visé — voir le commentaire de
 * `RunJudge` dans `types.ts` sur pourquoi cette copie existe et pourquoi elle
 * ne doit jamais s'en écarter : c'est elle que la clé étrangère composée
 * `run_judges_judge_fk` vérifie à l'insertion. */
export interface NewRunJudgeRow {
  id: string;
  run_id: string;
  judge_id: string;
  system_type: JudgeSystemTypeColumn;
  is_principal: boolean;
}

/** Une ligne de `judge_scores` telle qu'elle naît : en attente, sans verdict.
 *  `status`, `justification` et le reste prennent leur défaut en base — voir
 *  la migration. */
export interface NewJudgeScoreRow {
  run_judge_id: string;
  sample_id: string;
  run_id: string;
}

export interface LaunchJudges {
  judges: NewJudgeRow[];
  runJudges: NewRunJudgeRow[];
  judgeScores: NewJudgeScoreRow[];
}

/** Les lignes des trois tables de juges à créer pour un run neuf.
 *
 * Même geste que `cellsForRun` pour la matrice : tout est créé d'avance, en
 * attente — le job ne fait que remplir, jamais que créer. Voir la
 * conception, section « Les lignes de score sont créées d'avance ».
 *
 * Un juge par source, dans cet ordre :
 * - le principal, depuis `config.criterion`, `config.rubric` et
 *   `config.models.judge` — l'ancienne forme, toujours acceptée ;
 * - un par entrée de `config.judges`, les secondaires ordinaires — voir
 *   `JudgeSpec` ;
 * - un juge d'éveil, de type système, si `config.check_eval_awareness` ne
 *   vaut pas explicitement `false` — jamais depuis `config.judges`, qui n'en
 *   porte jamais : voir la docstring de `JudgeSpec` dans `types.ts`.
 *
 * Puis une ligne de `judge_scores` par (liaison, conversation) : chaque juge
 * ci-dessus croisé avec chaque élément de `sampleIds`.
 *
 * Les identifiants de `judges` et `run_judges` sont fabriqués ici plutôt que
 * laissés à la base : une ligne de `judge_scores` doit référencer sa liaison
 * avant que celle-ci existe réellement en base, ce qui exige de construire
 * les trois tables d'un coup, en mémoire, avant la première écriture.
 * `newId` — `crypto.randomUUID` par défaut — s'injecte pour que les tests
 * produisent une sortie déterministe.
 *
 * `runId` et `sampleIds` sont fournis par l'appelant : le run et ses cases
 * doivent déjà exister en base — leurs identifiants sont générés là-bas —
 * avant que cette fonction ne soit appelée. */
export function judgesForLaunch(
  config: EvalRunConfig,
  runId: string,
  createdBy: string,
  sampleIds: string[],
  newId: () => string = randomUUID,
): LaunchJudges {
  const judges: NewJudgeRow[] = [];
  const runJudges: NewRunJudgeRow[] = [];

  function link(judge: NewJudgeRow, isPrincipal: boolean): void {
    judges.push(judge);
    runJudges.push({
      id: newId(),
      run_id: runId,
      judge_id: judge.id,
      system_type: judge.system_type,
      is_principal: isPrincipal,
    });
  }

  link(
    {
      id: newId(),
      criterion: config.criterion,
      rubric: config.rubric,
      model: config.models.judge,
      // Sentinelle, jamais `null` : voir `JudgeSystemTypeColumn` dans
      // `types.ts`. « Ce juge est-il système ? » se lit désormais en
      // comparant cette valeur à `"ordinary"`, plus jamais en testant une
      // absence — un test de nullité rétabli ici ferait passer tous les
      // juges pour systèmes, la colonne n'étant plus jamais nulle en base.
      system_type: "ordinary",
      created_by: createdBy,
    },
    true,
  );

  for (const spec of config.judges ?? []) {
    link(
      {
        id: newId(),
        criterion: spec.criterion,
        rubric: spec.rubric,
        model: spec.model ?? config.models.judge,
        system_type: "ordinary",
        created_by: createdBy,
      },
      false,
    );
  }

  if (config.check_eval_awareness !== false) {
    link(
      {
        id: newId(),
        criterion: null,
        rubric: null,
        model: config.models.judge,
        system_type: "awake",
        created_by: createdBy,
      },
      false,
    );
  }

  const judgeScores = judgeScoresForSamples(
    runId,
    runJudges.map((runJudge) => runJudge.id),
    sampleIds,
  );

  return { judges, runJudges, judgeScores };
}

/** Les lignes de `judge_scores` à créer pour des cases neuves qui rejoignent
 *  un run déjà lancé — le même produit croisé (chaque juge vivant du run ×
 *  chaque conversation) que `judgesForLaunch` construit ci-dessus pour un run
 *  neuf, réduit au cas où les juges existent déjà et où seules les
 *  conversations sont neuves.
 *
 * Utilisée par `extendRun` (`runs.ts`) pour les cases qu'une extension
 * ajoute. Sans ces lignes, `write_judge_score` (moteur, côté
 * `supabase_store.py`) ne trouverait rien à mettre à jour : elle ne fait
 * qu'un `UPDATE` ciblé sur `(run_judge_id, sample_id)`, jamais un `INSERT` —
 * la ligne est censée exister déjà, en `pending`, depuis que la conversation
 * a été posée. Un verdict de juge sur une case neuve qu'on aurait oublié de
 * précréer ici se perdrait donc en silence : l'écriture ne toucherait aucune
 * ligne, sans lever d'erreur. */
export function judgeScoresForSamples(
  runId: string,
  runJudgeIds: string[],
  sampleIds: string[],
): NewJudgeScoreRow[] {
  const judgeScores: NewJudgeScoreRow[] = [];
  for (const runJudgeId of runJudgeIds) {
    for (const sampleId of sampleIds) {
      judgeScores.push({
        run_judge_id: runJudgeId,
        sample_id: sampleId,
        run_id: runId,
      });
    }
  }
  return judgeScores;
}
