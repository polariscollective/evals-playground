// Ce qu'un bon modèle aurait dû obtenir, et à quelle distance il est tombé.
//
// Une note brute ne se lit qu'à côté de l'échelle qui l'a produite, et deux
// lignes d'une même matrice peuvent être notées par deux juges sur deux
// échelles sans rapport. Écrire d'avance la note qu'un modèle se comportant
// bien devrait obtenir transforme chaque case en un écart à cette note —
// comparable d'une ligne à l'autre, d'un juge à l'autre.
//
// Trois idées se cachaient sous le mot « attendu », et les séparer est
// l'essentiel de la conception (voir
// docs/superpowers/specs/2026-09-09-targets-and-four-guides-design.md) :
//
//   - la CIBLE dit ce qu'un bon modèle fait, et s'en écarter EST le résultat ;
//   - le CONTRÔLE dit qu'une ligne doit tomber près de sa cible sans quoi rien
//     d'autre n'est lisible, et s'en écarter veut dire qu'il n'y a pas de
//     résultat du tout ;
//   - le PARI dit ce que le rédacteur croit qu'il va se passer, n'a pas de
//     bonne réponse, et reste en prose dans `note`.
//
// Le contrôle ne remplace jamais le nombre. Une ligne de taux de base qui
// dérive apprend deux choses à la fois — le décor pousse tout seul, ET le
// modèle dérive sans qu'on l'y pousse — et un simple réussi/raté en effacerait
// la moitié.
//
// Module pur, sans lecture ni écriture : c'est ce qui permet de l'éprouver
// seul, comme `view.ts` juste à côté.
import type { RubricLevel } from "./types";

/** Ce qu'un juge attend d'un scénario : la note d'un bon modèle, et si cette
 *  ligne est un contrôle.
 *
 * `check` absent vaut faux. La majorité des lignes ne sont pas des contrôles,
 * et écrire `check: false` cent fois serait du bruit. */
export interface JudgeTarget {
  expected: number;
  check?: boolean;
}

/** Les paliers d'une échelle qui portent une note, le palier « sans objet »
 *  retiré.
 *
 * Le palier exclu est une réponse — « la question ne s'appliquait pas » — et
 * non une note : il n'est sur aucun axe, et `mapScore` le met déjà dehors du
 * calcul d'une case. Il reste une CIBLE légitime, celle de la ligne témoin qui
 * vérifie que le juge sait répondre « sans objet » ; elle n'a simplement pas de
 * distance, ce que `deviation` dit en rendant `null`. */
function gradedValues(rubric: RubricLevel[] | undefined): number[] {
  return (rubric ?? [])
    .filter((level) => !level.excluded)
    .map((level) => level.value);
}

/** À quelle distance de sa cible une note est tombée, entre −1 et +1.
 *
 * Zéro : le modèle a fait ce qu'il devait. ±1 : il est aussi loin que
 * l'échelle le permet.
 *
 * **Le dénominateur est la place disponible, pas l'étendue de l'échelle**, et
 * c'est tout l'intérêt de la formule. Sur une échelle 0–4, une ligne dont la
 * cible est 0 peut s'écarter de quatre paliers ; une ligne dont la cible est 2
 * ne peut s'écarter que de deux. Diviser les deux par l'étendue plafonnerait la
 * seconde à 0,5 : elle paraîtrait éternellement mieux tenue que la première,
 * alors qu'elle est aussi loin qu'elle peut l'être. C'est un artefact de
 * l'endroit où la cible est posée, pas un fait sur le modèle.
 *
 * Quand la cible est à un bout de l'échelle — le cas courant, « un bon modèle
 * refuse » — un seul côté existe et la formule redevient l'évidente,
 * `(note − cible) / étendue`.
 *
 * `null` quand il n'y a pas de distance à calculer : la cible ou la note est le
 * palier exclu, ou n'est pas sur cette échelle du tout. L'appelant décide quoi
 * en faire — la matrice compte alors les tentatives tombées sur la cible plutôt
 * que d'afficher un nombre.
 *
 * Ce que le nombre N'EST PAS, et que les guides doivent dire : une mesure. Les
 * paliers d'une échelle ordinale n'ont jamais été mesurés les uns contre les
 * autres, donc 0,5 est PLUS LOIN que 0,25, jamais DEUX FOIS PIRE. */
export function deviation(
  grade: number,
  target: number,
  rubric: RubricLevel[] | undefined,
): number | null {
  const scale = gradedValues(rubric);
  if (!scale.includes(target) || !scale.includes(grade)) return null;
  if (grade === target) return 0;
  const room =
    grade > target ? Math.max(...scale) - target : target - Math.min(...scale);
  // Une échelle qui n'a qu'un palier notable ne laisse aucune place pour s'en
  // écarter. Sans ce garde-fou on diviserait par zéro pour rendre l'infini.
  if (room === 0) return null;
  return (grade - target) / room;
}

/** Ce qui cloche dans la liste de cibles d'un juge, ou `null` si elle tient.
 *
 * `judgeName` sert à nommer le juge fautif dans le message : un run peut en
 * porter cinq, et « les cibles sont incomplètes » n'aiderait personne.
 *
 * **Tout ou rien.** Une liste absente est valide et veut dire quelque chose :
 * le rédacteur explorait et ne savait pas à quoi ressemble un bon résultat. Une
 * liste présente couvre tous les scénarios. Il n'y a délibérément pas d'état
 * intermédiaire — six mois plus tard, un trou ne se distingue pas d'un oubli.
 *
 * C'est aussi ce qui donne à ce champ son intérêt principal : le remplir oblige
 * qui écrit le run à dire ce qu'il cherche avant de dépenser quoi que ce soit. */
export function targetsProblem(
  targets: JudgeTarget[] | null | undefined,
  scenarioCount: number,
  rubric: RubricLevel[] | undefined,
  judgeName: string,
): string | null {
  if (targets == null) return null;
  if (!Array.isArray(targets)) {
    return `${judgeName}: targets must be a list, one entry per scenario.`;
  }
  const scale = (rubric ?? []).map((level) => level.value);
  if (scale.length === 0) {
    return `${judgeName}: targets need a scale to be expressed in, and this judge has none.`;
  }
  if (targets.length !== scenarioCount) {
    return (
      `${judgeName}: targets holds ${targets.length} entries for ${scenarioCount} scenarios. ` +
      `Write one for every scenario, or none at all — a partial list cannot be told from an oversight later.`
    );
  }
  for (const [index, target] of targets.entries()) {
    if (
      target == null ||
      typeof target !== "object" ||
      typeof target.expected !== "number"
    ) {
      return `${judgeName}: targets[${index}] needs an \`expected\` grade.`;
    }
    // Le palier exclu compte : c'est la cible de la ligne témoin qui vérifie
    // que le juge sait répondre « sans objet ». D'où `scale` et non
    // `gradedValues` ici.
    if (!scale.includes(target.expected)) {
      return (
        `${judgeName}: targets[${index}] expects ${target.expected}, which is not a grade on this ` +
        `judge's scale (${scale.join(", ")}).`
      );
    }
    if (target.check !== undefined && typeof target.check !== "boolean") {
      return `${judgeName}: targets[${index}].check must be true or false.`;
    }
  }
  return null;
}

/** La cible d'une ligne pour un juge donné, ou `undefined` s'il n'en porte pas.
 *
 * Aligné sur `scenario_index`, qui ne fait que croître : une extension ajoute
 * des lignes à la fin, jamais au milieu. Un index hors liste rend `undefined`
 * plutôt que de lever — une extension peut être en cours d'écriture, et la
 * matrice doit rester affichable. */
export function targetOf(
  targets: JudgeTarget[] | null | undefined,
  scenarioIndex: number,
): JudgeTarget | undefined {
  if (targets == null) return undefined;
  return targets[scenarioIndex];
}

/** Les index des lignes que ce juge déclare comme contrôles.
 *
 * Un contrôle est bizarre exprès : il ne doit entrer dans aucun chiffre calculé
 * sur plusieurs lignes. Suit le juge AFFICHÉ, comme tout le reste de la matrice
 * — la même ligne peut être un contrôle chez le principal et une ligne
 * ordinaire chez un autre juge. */
export function controlRows(
  targets: JudgeTarget[] | null | undefined,
): Set<number> {
  const rows = new Set<number>();
  (targets ?? []).forEach((target, index) => {
    if (target?.check) rows.add(index);
  });
  return rows;
}
