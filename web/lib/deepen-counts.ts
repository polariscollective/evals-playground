// Combien d'essais d'un run portent chaque palier de l'échelle — ce que le
// panneau d'extension affiche à côté de chaque note qu'on peut choisir
// d'approfondir.
//
// Compté depuis les essais que la page a déjà en mémoire, jamais depuis une
// requête à part : les tenir à jour serait le travail de la page, pas d'un
// aller-retour supplémentaire pour une question que ses données répondent
// déjà. Un palier que personne ne porte doit ressortir à zéro — sans quoi le
// cocher enverrait une demande qui n'approfondirait rien.
//
// Depuis les juges multiples, la note d'un essai n'est plus la colonne
// `eval_samples.score` (supprimée par la migration
// `20260906093000_drop_eval_samples_score_columns.sql`, dépôt
// polaris-supabase) : c'est la ligne de `judge_scores` du juge PRINCIPAL sur
// cet essai — le seul que ce panneau approfondit, exactement comme la
// matrice qu'il prolonge (voir « La matrice suit le principal »,
// docs/superpowers/specs/2026-09-06-juges-multiples.md). L'appelant joint
// `EvalSample` et `judge_scores` avant d'arriver ici ; ce module ne lit ni
// l'une ni l'autre table.
import { addEstimates, estimateDeepening } from "./pricing.ts";
import type {
  CostEstimate,
  EvalRunConfig,
  JudgeScore,
  LengthAssumption,
  RubricLevel,
  SampleStatus,
} from "./types";

/** Le statut et la note du juge principal sur un essai, réduits à ce que ce
 *  module en utilise — même dessin que `JudgeVerdict` dans `awareness.ts`,
 *  redéfini ici plutôt qu'importé : ce fichier n'a rien à voir avec l'éveil,
 *  et n'a pas à en dépendre pour une forme aussi petite. */
export type PrincipalVerdict = Pick<JudgeScore, "status" | "score">;

/** Un essai tel que ces comptes le voient : le modèle qui l'a joué, le statut
 *  de son exécution, et le verdict du juge principal — jamais un autre juge
 *  non supprimé. */
export interface DeepenSample {
  target_model: string;
  status: SampleStatus;
  principal: PrincipalVerdict;
}

/** `DeepenSample`, plus ce qu'il faut pour grouper ensuite par modèle et par
 *  profondeur de départ (voir `groupByModelAndDepth`) — un compte n'a pas
 *  besoin de connaître `turns_done`, mais `samplesForSelection` doit le faire
 *  voyager avec l'essai pour que `extendRun` puisse regrouper ce qu'il vient
 *  de lire en base de la même façon que le panneau regroupe ce qu'il a déjà
 *  en mémoire. */
export interface DeepenSampleWithDepth extends DeepenSample {
  turns_done: number | null;
}

/** Combien d'essais, au total et répartis par modèle cible.
 *
 * La répartition par modèle sert le devis : `estimateDeepening` ne rend un
 * prix juste que pour un seul tarif à la fois (voir son commentaire dans
 * `pricing.ts`), et un choix d'essais à cheval sur plusieurs modèles se
 * chiffre en l'appelant une fois par modèle, avec son propre compte. */
export interface DeepenCount {
  total: number;
  byModel: Record<string, number>;
}

function emptyCount(): DeepenCount {
  return { total: 0, byModel: {} };
}

function record(count: DeepenCount, model: string): void {
  count.total += 1;
  count.byModel[model] = (count.byModel[model] ?? 0) + 1;
}

/** Un essai est-il noté par le principal : sa conversation est jouée, et il
 *  lui a donné une note — peu importe laquelle, `excluded` compris (voir
 *  `countsByLevel`). Peu importe aussi *pourquoi* il n'y en a pas : en
 *  attente, tombé, conversation vide ou note hors échelle se lisent tous
 *  comme « pas encore d'essai à reprendre à ce palier », exactement comme
 *  avant que la note ne vive dans sa propre table. */
function isGraded(sample: DeepenSample): boolean {
  return sample.status === "done" && sample.principal.score !== null;
}

/** Un compte par palier, dans l'ordre où `rubric` les donne.
 *
 * Un essai compte pour son palier même si celui-ci est `excluded` : approfondir
 * un essai jugé « sans objet » a le même sens que pour n'importe quel autre —
 * seule la moyenne l'écarte, pas la liste des essais qu'on peut reprendre. */
export function countsByLevel(
  samples: DeepenSample[],
  rubric: RubricLevel[],
): DeepenCount[] {
  return rubric.map((level) => {
    const count = emptyCount();
    for (const sample of samples) {
      if (sample.status === "done" && sample.principal.score === level.value) {
        record(count, sample.target_model);
      }
    }
    return count;
  });
}

/** Tous les essais notés du run par le principal, quel que soit leur palier —
 *  ce que couvre `deepen: "all"`. */
export function countAllGraded(samples: DeepenSample[]): DeepenCount {
  const count = emptyCount();
  for (const sample of samples) {
    if (isGraded(sample)) record(count, sample.target_model);
  }
  return count;
}

/** Le compte pour une sélection telle que le panneau la construit :
 *  `"all"` pour tous les essais notés, une liste de notes pour ne prendre
 *  que les essais qui les portent, `null` pour n'en approfondir aucun. */
export function countsForSelection(
  samples: DeepenSample[],
  selection: "all" | number[] | null,
): DeepenCount {
  if (selection === null) return emptyCount();
  if (selection === "all") return countAllGraded(samples);
  const values = new Set(selection);
  const count = emptyCount();
  for (const sample of samples) {
    if (
      sample.status === "done" &&
      sample.principal.score !== null &&
      values.has(sample.principal.score)
    ) {
      record(count, sample.target_model);
    }
  }
  return count;
}

/** Les essais qu'une sélection retient, dans l'ordre où `samples` les donne —
 *  même filtre que `countsForSelection`, mais les essais eux-mêmes plutôt que
 *  leur compte, `turns_done` compris : c'est ce qu'il faut pour les grouper
 *  ensuite par profondeur de départ (voir `groupByModelAndDepth`) — un compte
 *  par modèle ne porte plus cette information. */
export function samplesForSelection(
  samples: DeepenSampleWithDepth[],
  selection: "all" | number[] | null,
): DeepenSampleWithDepth[] {
  if (selection === null) return [];
  if (selection === "all") {
    return samples.filter(isGraded);
  }
  const values = new Set(selection);
  return samples.filter(
    (sample) =>
      sample.status === "done" &&
      sample.principal.score !== null &&
      values.has(sample.principal.score),
  );
}

/** Un essai à approfondir, réduit aux deux champs qui fixent son prix : le
 *  modèle qui le joue, et la profondeur d'où il repart. Une `EvalSample`
 *  satisfait cette forme sans conversion ; une ligne lue en base — seulement
 *  `target_model` et `turns_done` demandés — aussi. */
export interface DeepenCell {
  target_model: string;
  turns_done: number | null;
}

/** Un groupe d'essais qui partagent le modèle qui les joue et la profondeur
 *  d'où ils repartent — la seule granularité à laquelle `estimateDeepening`
 *  rend un prix juste (voir son commentaire dans `pricing.ts`). */
export interface DeepenGroup {
  target_model: string;
  turns_done: number;
  cells: number;
}

/** Regroupe des essais à approfondir par couple (modèle cible, profondeur de
 *  départ) — et non par le seul modèle, qui suffisait avant qu'un run puisse
 *  être approfondi plus d'une fois. Depuis, les essais qu'on a déjà poussés
 *  sont plus profonds que ceux qu'on avait laissés, et un `"all"` — ou une
 *  liste de notes qui couvre les deux groupes — les mélangerait dans un même
 *  compte si on ne groupait que sur le modèle.
 *
 *  `fallbackTurnsDone` couvre l'essai sans profondeur enregistrée : ça
 *  n'arrive pas pour un essai `done`, qui écrit toujours la sienne (voir la
 *  migration qui a introduit la colonne), mais son type reste nullable pour
 *  les essais jamais joués. */
export function groupByModelAndDepth(
  cells: DeepenCell[],
  fallbackTurnsDone: number,
): DeepenGroup[] {
  const groupes = new Map<string, DeepenGroup>();
  for (const cell of cells) {
    const turnsDone = cell.turns_done ?? fallbackTurnsDone;
    const clé = `${cell.target_model}\0${turnsDone}`;
    const groupe = groupes.get(clé);
    if (groupe) {
      groupe.cells += 1;
    } else {
      groupes.set(clé, {
        target_model: cell.target_model,
        turns_done: turnsDone,
        cells: 1,
      });
    }
  }
  return [...groupes.values()];
}

/** Le devis d'approfondir ces essais jusqu'à `to` tours.
 *
 * Un appel à `estimateDeepening` par groupe — voir `groupByModelAndDepth` —
 * sommés avec `addEstimates` : elle ne rend un prix juste que pour un seul
 * modèle et une seule profondeur de départ à la fois. Grouper par modèle seul
 * sous-estimerait le groupe resté en arrière depuis un précédent
 * approfondissement, en le facturant depuis une profondeur qu'il n'a pas
 * atteinte.
 *
 * Partagée entre le panneau, qui l'appelle sur la sélection qu'il a déjà en
 * mémoire (voir `samplesForSelection`), et `extendRun`, qui l'appelle sur ce
 * qu'il vient de lire en base pour la même extension : aucun des deux ne doit
 * facturer les essais déjà approfondis au tarif de ceux qu'on avait laissés. */
export function estimateDeepeningCost(
  config: EvalRunConfig,
  cells: DeepenCell[],
  to: number,
  fallbackTurnsDone: number,
  /** Les longueurs supposées, transmises telles quelles à `estimateDeepening`
   *  — réponses évaluées et adversaire, chacun la sienne. */
  lengths?: LengthAssumption | number | null,
): CostEstimate | null {
  return groupByModelAndDepth(cells, fallbackTurnsDone).reduce<CostEstimate | null>(
    (total, groupe) =>
      addEstimates(
        total,
        estimateDeepening(
          { ...config, models: { ...config.models, targets: [groupe.target_model] } },
          groupe.turns_done,
          to,
          groupe.cells,
          lengths,
        ),
      ),
    null,
  );
}
