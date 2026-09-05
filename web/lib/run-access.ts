// Qui a le droit de lire les journaux d'un run.
//
// Une seule fonction décide, et les deux routes de `/inspect-view` l'appellent
// en première ligne. Elle refait la règle de `loadPublicRun` — un run vivant,
// et soit une session valide, soit `is_public` — sans charger le run entier :
// servir un journal ne demande pas de connaître ses cases.
//
// Module à part plutôt qu'une fonction de plus dans `runs.ts` : celui-ci fait
// déjà 607 lignes et n'a jamais eu besoin de connaître l'authentification.
import "server-only";
import { requireUser } from "@/auth";
import { RUNS, select } from "./supabase";

/** Le run existe-t-il, et cet appelant peut-il en lire les journaux ?
 *
 * Un run inconnu, mis à la corbeille, ou non publié devant un inconnu donnent
 * tous `false` : de dehors ils doivent se ressembler, sinon l'adresse dit qui
 * existe. */
export async function canReadRun(runId: string): Promise<boolean> {
  const rows = await select<{ is_public: boolean | null }>(RUNS, {
    id: `eq.${runId}`,
    deleted_at: "is.null",
    select: "is_public",
    limit: 1,
  });
  const run = rows[0];
  if (!run) return false;
  if (run.is_public === true) return true;

  const user = await requireUser();
  return !("response" in user);
}
