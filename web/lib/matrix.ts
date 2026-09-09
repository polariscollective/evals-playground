// La matrice d'un run, agrégée depuis ses cases.
//
// Portage de ce que faisait `backend/playground/matrix.py` : le calcul vit
// désormais côté lecture, puisque c'est l'interface qui l'affiche et l'export
// qui le recopie.
//
// Depuis les juges multiples, la note d'une conversation n'est plus une
// colonne d'`eval_samples` (`score`, `justification` — supprimées par la
// migration `20260906093000_drop_eval_samples_score_columns.sql`, dépôt
// polaris-supabase) : c'est une ligne de `judge_scores`, une par (juge,
// conversation). **La matrice suit le juge principal** — voir la conception,
// docs/superpowers/specs/2026-09-06-juges-multiples.md, section « L'écran » —
// jamais un autre juge non supprimé : `cellsOf`/`overallMean` ne regardent
// donc que le verdict du principal sur chaque conversation, que l'appelant
// leur apporte déjà joint depuis `EvalSample` et `judge_scores`.
import type { Cell, Progress, RubricLevel, SampleStatus } from "./types";
import { controlRows, deviation, targetOf } from "./targets.ts";
import type { JudgeTarget } from "./types";
import { PLAIN_VIEW, aggregate, mapScore, type MatrixView } from "./view.ts";
// Le seuil et le prédicat du voyant du run : le compte par case doit
// s'arrêter exactement à la même règle, sans quoi additionner les marqueurs
// de case ne retomberait plus sur le chiffre affiché en haut de l'écran.
import { isAwarenessFlagged, type JudgeVerdict } from "./awareness.ts";

/** Où en est un run, compté sur ses cases plutôt que sur un compteur à part.
 *
 * `total` vient du nombre de lignes, toutes créées au lancement : la
 * progression est donc exacte avant même que le job ne démarre.
 *
 * Ne regarde que le statut d'exécution de la conversation (`EvalSample.status`,
 * une colonne que la migration des juges multiples n'a pas touchée) — jamais
 * le verdict d'un juge, qui vit ailleurs désormais. Une conversation `done`
 * compte comme faite ici même si aucun juge n'est encore passé dessus :
 * `cellsOf`, plus bas, est l'endroit qui distingue « jouée, pas encore
 * jugée » de « jugée ». */
export function progressOf(samples: { status: SampleStatus }[]): Progress {
  const progress: Progress = {
    total: samples.length,
    done: 0,
    running: 0,
    pending: 0,
    errored: 0,
    cancelled: 0,
  };
  for (const sample of samples) {
    if (sample.status === "done") progress.done += 1;
    else if (sample.status === "running") progress.running += 1;
    else if (sample.status === "error") progress.errored += 1;
    else if (sample.status === "cancelled") progress.cancelled += 1;
    else progress.pending += 1;
  }
  return progress;
}

function emptyCell(): Cell {
  return {
    judged: 0,
    unjudged: 0,
    errored: 0,
    cancelled: 0,
    excluded: 0,
    pending: 0,
    mean: null,
    grades: {},
    cost_usd: 0,
    awareness_flagged: 0,
  };
}

/** Une conversation telle que la matrice la voit : ses coordonnées, le statut
 *  de son *exécution* — indépendant de tout juge, c'est `EvalSample.status` —
 *  et le verdict du juge PRINCIPAL, le seul que la matrice affiche.
 *
 * `awake` voyage à part de `principal` : ce sont deux juges différents sur la
 * même conversation. Le badge d'éveil d'une case ne dépend en rien de ce que
 * le principal a tranché — une case en panne, ou jamais jugée par le
 * principal, garde son signal d'éveil si le juge d'éveil, lui, a répondu.
 *
 * L'appelant construit cette forme en joignant `EvalSample` — pour les
 * quatre premiers champs — et les lignes de `judge_scores` du principal et,
 * si le run en a un, de la liaison `awake` (voir `findAwakeJudge`,
 * `awareness.ts`), filtrées par `sample_id`. Ce module ne lit ni
 * `eval_samples` ni `judge_scores` lui-même. */
export interface MatrixSample {
  scenario_index: number;
  target_model: string;
  status: SampleStatus;
  cost_usd: number | null;
  principal: JudgeVerdict;
  /** `undefined` : aucune liaison de type `awake` sur ce run — jamais
   *  demandée au lancement, ou déliée depuis. Distinct d'un verdict
   *  `"pending"` : « pas de juge d'éveil » et « juge d'éveil pas encore
   *  passé » ne doivent pas se confondre, la première ne devenant jamais la
   *  seconde. */
  awake?: JudgeVerdict;
}

/** La matrice, une entrée par scénario.
 *
 * La liste garde toujours `scenarioCount` entrées, même vides : elle est
 * alignée sur `config.scenarios`, et une ligne manquante décalerait toute la
 * lecture.
 *
 * Une case sans note est comptée à part plutôt qu'ignorée — et une case en
 * panne encore à part. La moyenne ne dit rien de ce qu'elle n'a pas pu
 * mesurer, et « le modèle a obtenu zéro » n'est pas « on ne sait pas ».
 *
 * Deux statuts se combinent désormais pour placer une conversation : celui de
 * son exécution (`sample.status`) d'abord — une conversation qui n'a pas
 * fini de jouer, ou jamais commencée, ou tombée en cours de jeu, ne regarde
 * même pas le juge. Ensuite seulement, pour une conversation `done`, celui du
 * verdict du principal (`sample.principal.status`) : `"pending"` (le job n'y
 * est pas encore passé) compte comme en attente au même titre qu'une
 * conversation encore en cours, et `"error"` (le juge est tombé sur une
 * conversation par ailleurs valide) compte comme en panne au même titre
 * qu'une exécution qui a échoué — ce sont deux pannes différentes, mais la
 * matrice ne les distingue pas plus qu'elle ne le faisait avant. */
export function cellsOf(
  samples: MatrixSample[],
  scenarioCount: number,
  rubric?: RubricLevel[],
  view: MatrixView = PLAIN_VIEW,
  targets?: JudgeTarget[] | null,
): Record<string, Cell>[] {
  const cells: Record<string, Cell>[] = Array.from(
    { length: scenarioCount },
    () => ({}),
  );
  // La note telle que cette lecture la compte : la note elle-même, ou la
  // distance à ce que le juge attendait de CETTE ligne. `null` la met dehors
  // du calcul, exactement comme un palier exclu — et une ligne sans cible en
  // lecture d'écart n'a rien à montrer, ce qui est le cas d'une extension dont
  // les cibles n'ont pas suivi.
  const valueOf = (score: number, scenarioIndex: number): number | null => {
    if (!view.relative) return mapScore(score, rubric, view);
    const target = targetOf(targets, scenarioIndex);
    if (target === undefined) return null;
    return deviation(score, target.expected, rubric);
  };
  // Les notes sont gardées et non additionnées au vol : une médiane ou un
  // minimum demandent de les voir toutes, ce qu'une somme courante interdit.
  const notes = new Map<string, number[]>();

  for (const sample of samples) {
    if (sample.scenario_index < 0 || sample.scenario_index >= scenarioCount) {
      continue;
    }
    const row = cells[sample.scenario_index];
    if (!row[sample.target_model]) row[sample.target_model] = emptyCell();
    const cell = row[sample.target_model];
    cell.cost_usd += sample.cost_usd ?? 0;
    // Indépendant du statut d'exécution et du verdict du principal : le juge
    // d'éveil note une conversation que le principal ait pu la trancher ou
    // non. Même prédicat que `awarenessSummary` au niveau du run
    // (`isAwarenessFlagged`) — pas seulement le même seuil — c'est ce qui
    // tient l'invariant de somme.
    if (sample.awake && isAwarenessFlagged(sample.awake)) {
      cell.awareness_flagged += 1;
    }

    if (sample.status === "pending" || sample.status === "running") {
      cell.pending += 1;
    } else if (sample.status === "cancelled") {
      // Jamais commencée. Pas une panne : on a décidé de ne pas la faire.
      cell.cancelled += 1;
    } else if (sample.status === "error") {
      // L'exécution elle-même a échoué : il n'y a rien à juger.
      cell.errored += 1;
    } else if (sample.principal.status === "pending") {
      // Jouée, mais le principal n'y est pas encore passé.
      cell.pending += 1;
    } else if (sample.principal.status === "error") {
      // Le principal est tombé sur une conversation par ailleurs valide.
      cell.errored += 1;
    } else if (sample.principal.score === null) {
      cell.unjudged += 1;
    } else {
      const valeur = valueOf(sample.principal.score, sample.scenario_index);
      if (valeur === null) {
        // Mise dehors, soit par l'échelle — le juge a tranché « sans objet » —
        // soit par la vue. C'est une réponse, pas une absence de réponse, mais
        // elle n'entre pas dans le calcul.
        cell.excluded += 1;
      } else {
        cell.judged += 1;
        const key = `${sample.scenario_index} ${sample.target_model}`;
        notes.set(key, [...(notes.get(key) ?? []), valeur]);
      }
    }
  }

  for (const [key, values] of notes) {
    const separator = key.indexOf(" ");
    const index = Number(key.slice(0, separator));
    const target = key.slice(separator + 1);
    const cell = cells[index][target];
    cell.mean = aggregate(values, view.aggregate);
    // Les notes étaient déjà gardées entières pour la médiane ; les compter
    // ici ne coûte rien de plus et rend lisible ce qu'une moyenne cache.
    for (const value of values) {
      cell.grades[value] = (cell.grades[value] ?? 0) + 1;
    }
  }

  return cells;
}

/** Le chiffre d'un run entier, ou null si rien n'a pu être noté.
 *
 * Calculé sur les notes et non sur les chiffres des cases : agréger des agrégats
 * donnerait le même poids à une case notée dix fois et à une case notée une
 * seule.
 *
 * Ne regarde que le verdict du juge PRINCIPAL, comme `cellsOf` : peu importe
 * *pourquoi* il n'a pas noté (en attente, tombé, conversation vide, note hors
 * échelle) — un score nul n'entre jamais dans la moyenne, exactement comme
 * avant que la note ne vive dans sa propre table. */
export function overallMean(
  samples: Pick<MatrixSample, "principal" | "scenario_index">[],
  rubric?: RubricLevel[],
  view: MatrixView = PLAIN_VIEW,
  targets?: JudgeTarget[] | null,
): number | null {
  // Les lignes de contrôle sortent du chiffre d'ensemble. Elles sont bizarres
  // exprès — une ligne de faisabilité vise le HAUT de l'échelle, un modèle
  // coopératif étant censé y aller — et les mêler aux autres ferait dire à ce
  // nombre quelque chose que personne n'a demandé.
  //
  // Suit le juge dont on affiche les cibles, comme tout le reste de la
  // matrice : la même ligne peut être un contrôle chez le principal et une
  // ligne ordinaire chez un autre juge.
  const controls = controlRows(targets);
  const notes = samples
    .filter((sample) => !controls.has(sample.scenario_index))
    .map((sample) => {
      if (sample.principal.score === null) return null;
      if (!view.relative) return mapScore(sample.principal.score, rubric, view);
      const target = targetOf(targets, sample.scenario_index);
      if (target === undefined) return null;
      return deviation(sample.principal.score, target.expected, rubric);
    })
    .filter((value): value is number => value !== null);
  return aggregate(notes, view.aggregate);
}
