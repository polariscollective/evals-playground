// Les lignes des trois tables de juges, à créer pour un run neuf.
//
// Séparé de `runs.ts` pour la même raison que `cells.ts` : c'est la seule
// partie de ce mécanisme qui mérite d'être éprouvée seule — le reste n'est
// que des écritures Supabase — et `runs.ts` importe `server-only`, qui casse
// l'import sous `node --test`. Voir le commentaire en tête de `cells.ts`.
import { randomUUID } from "node:crypto";
import type { EvalRunConfig, JudgeSystemType, RubricLevel } from "./types";

/** Une ligne de `judges` telle qu'elle naît, avant insertion. */
export interface NewJudgeRow {
  id: string;
  criterion: string | null;
  rubric: RubricLevel[] | null;
  model: string;
  system_type: JudgeSystemType | null;
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
  system_type: JudgeSystemType | null;
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
      system_type: null,
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
        system_type: null,
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

  const judgeScores: NewJudgeScoreRow[] = [];
  for (const runJudge of runJudges) {
    for (const sampleId of sampleIds) {
      judgeScores.push({
        run_judge_id: runJudge.id,
        sample_id: sampleId,
        run_id: runId,
      });
    }
  }

  return { judges, runJudges, judgeScores };
}
