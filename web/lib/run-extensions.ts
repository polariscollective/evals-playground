// L'historique des extensions d'un run, avec le coût réel de chacune déduit.
//
// `eval_runs.extensions` ne porte que ce qui était su au moment de chaque
// extension : la demande, son devis, et le coût du run juste avant qu'elle ne
// s'applique. Rien n'y est jamais réécrit après coup — voir la migration
// `evals/supabase/migrations/20260905203414_run_extensions_log.sql`. Le coût
// réel de chaque extension est donc calculable, jamais stocké : c'est l'écart
// entre son `cost_before_usd` et celui de l'extension suivante, ou le coût
// actuel du run pour la dernière.
//
// Pure et calculable, comme `matrix.ts` : la page et un test la lisent pareil.
import type { EvalRun, RunExtensionLogEntry } from "./types";

/** Une entrée de l'historique, augmentée de ce qu'elle a réellement coûté. */
export interface RunExtension extends RunExtensionLogEntry {
  /** `after - cost_before_usd`, `after` étant le `cost_before_usd` de
   *  l'extension suivante ou, pour la dernière, `run.cost_usd`.
   *
   * `null` dès que l'un des deux bouts manque — jamais 0, qui affirmerait à
   * tort une extension gratuite alors que son coût est simplement inconnu :
   * run qui n'a pas encore fini de tourner depuis, ou dont un modèle employé
   * n'a pas de tarif. */
  actual_cost_usd: number | null;
}

/** L'écart entre deux coûts consolidés, ou `null` si l'un des deux manque. */
function deduct(before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return after - before;
}

/** Les extensions d'un run, dans l'ordre où elles ont été demandées, chacune
 *  avec son coût réel déduit.
 *
 * Vide sur un run qui n'a jamais été étendu. */
export function extensionsOf(run: EvalRun): RunExtension[] {
  return run.extensions.map((entry, index) => {
    const next = run.extensions[index + 1];
    const after = next ? next.cost_before_usd : run.cost_usd;
    return { ...entry, actual_cost_usd: deduct(entry.cost_before_usd, after) };
  });
}
