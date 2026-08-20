// La température de chaque répétition d'un lot de cases.
//
// Ce calcul vit ici plutôt que dans le job, parce que c'est la route d'API qui
// décide des cases à créer, et elle seule connaît la frontière d'un lot. Un run
// qu'on complète reçoit un étalement pour ses *nouvelles* répétitions ; les
// anciennes gardent celui qu'elles ont eu, puisque chaque case porte sa propre
// température en base. Recalculer après coup depuis la configuration du run
// réécrirait l'histoire des cases déjà payées.
//
// Porté de `temperatures_for` (backend/playground/eval_task.py), dont il reprend
// les tests.
import type { TemperatureSpec } from "./types";

/** La température de chaque répétition.
 *
 * Sans consigne, aucune température n'est envoyée et le fournisseur applique son
 * défaut. Avec une borne haute, les répétitions s'étalent linéairement entre les
 * deux bornes, celles-ci comprises. Une répétition unique prend la borne basse :
 * il n'y a pas d'intervalle à parcourir.
 *
 * La dernière répétition renvoie `spec.max` tel quel plutôt que de le calculer
 * par accumulation : `spec.min + step * index` peut retomber à un cheveu de la
 * borne haute par arrondi flottant (`0.2 + 0.7 === 0.8999999999999999`), ce que
 * la borne demandée par l'utilisateur ne doit pas subir. */
export function temperaturesFor(
  spec: TemperatureSpec | null | undefined,
  repetitions: number,
): (number | null)[] {
  const indices = Array.from({ length: repetitions }, (_, index) => index);
  if (!spec) return indices.map(() => null);
  const max = spec.max;
  if (max == null || repetitions === 1) return indices.map(() => spec.min);
  const step = (max - spec.min) / (repetitions - 1);
  return indices.map((index) =>
    // Arrondi parce que ces valeurs sont écrites en base et relues dans les
    // exports : `0.2 + 0.1` vaut 0.30000000000000004, et quatre décimales
    // dépassent déjà de loin ce qu'un fournisseur distingue.
    index === repetitions - 1
      ? max
      : Math.round((spec.min + step * index) * 1e4) / 1e4,
  );
}
