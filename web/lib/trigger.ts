// Démarrer le job qui exécute un run.
//
// En déploiement, la demande part vers `polaris-batch-trigger`, un service
// Cloud Run qui a l'identité GCP que Vercel n'a pas, et qui lance le Cloud Run
// Job. En développement, sans ce service, le job est lancé en sous-process
// local — le seul moyen de garder l'application utilisable sans GCP, et sans
// introduire une seconde forme de stockage.
import "server-only";
import { spawn } from "node:child_process";

const JOB_NAME = process.env.EVAL_JOB_NAME || "evals-playground-runner";

/** L'interpréteur qui exécute le job en développement, entièrement pris dans
 * l'environnement.
 *
 * Aucun chemin littéral dans le code, volontairement : Turbopack analyse le
 * premier argument de `spawn`, y voit un fichier à empaqueter, et échoue sur le
 * lien symbolique `.venv/bin/python` qui sort de sa racine. Le passer par
 * `EVAL_PYTHON` sort le chemin de son analyse — et rend explicite une commodité
 * qui n'a de sens que sur une machine de développement.
 *
 * `.env.example` donne la valeur habituelle. */
const LOCAL_PYTHON = "EVAL_PYTHON";

export type JobMode = "run" | "rejudge";

/** Où le job a tourné. Enregistré sur le run : le local et le déployé écrivent
 * dans la même base, et sans marqueur un essai jetable ressemble à un vrai
 * run. */
export type Origin = "local" | "cloud-run";

export interface Started {
  execution: string;
  origin: Origin;
}

/** Le sous-process local peut-il remplacer le service Cloud Run ?
 *
 * Verrouillé sur `NODE_ENV` en plus de l'absence d'URL, exactement comme le
 * court-circuit d'authentification : une variable oubliée sur un déploiement ne
 * doit pas transformer une instance Vercel en machine d'exécution — elle n'a de
 * toute façon aucune clé de fournisseur, et le run échouerait à chaque case. */
function canRunLocally(): boolean {
  // `EVAL_PYTHON` est la déclaration d'intention du développeur : il veut
  // exécuter le job ici. Elle l'emporte sur `BATCH_TRIGGER_URL`, qui reste
  // souvent renseigné dans un `.env` sans qu'on veuille pour autant déclencher
  // un job distant à chaque essai.
  return (
    process.env.NODE_ENV !== "production" && Boolean(process.env[LOCAL_PYTHON])
  );
}

/** Lance le job en sous-process, depuis la racine du dépôt.
 *
 * Détaché et sans canaux hérités : la requête HTTP qui l'a démarré se termine
 * tout de suite, et le job continue. Un `spawn` attaché mourrait avec le
 * worker Next au premier rechargement à chaud. */
function runLocally(runId: string, mode: JobMode): string {
  const repoRoot = `${process.cwd()}/..`;
  const interpreter = process.env[LOCAL_PYTHON] as string;
  const child = spawn(interpreter, ["-m", "playground.batch_job"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: `${repoRoot}/backend`,
      EVAL_RUN_ID: runId,
      EVAL_JOB_MODE: mode,
    },
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return `local:${child.pid}`;
}

/** Démarre le job, et renvoie de quoi le retrouver.
 *
 * Throws:
 *   L'erreur du proxy, telle quelle. Un déclenchement qui échoue doit se voir :
 *   le run reste alors `pending` avec son message, plutôt que d'attendre
 *   indéfiniment un job qui n'a jamais démarré.
 */
export async function startJob(
  runId: string,
  mode: JobMode = "run",
): Promise<Started> {
  if (canRunLocally()) {
    return { execution: runLocally(runId, mode), origin: "local" };
  }

  const url = process.env.BATCH_TRIGGER_URL;
  const secret = process.env.BATCH_TRIGGER_SECRET;
  if (!url || !secret) {
    throw new Error(
      process.env.NODE_ENV === "production"
        ? "BATCH_TRIGGER_URL and BATCH_TRIGGER_SECRET must both be set."
        : "Set BATCH_TRIGGER_URL to use the deployed trigger, or EVAL_PYTHON to" +
          " run the job locally.",
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job: JOB_NAME,
        env: { EVAL_RUN_ID: runId, EVAL_JOB_MODE: mode },
      }),
      cache: "no-store",
    });
  } catch (error) {
    // Un proxy injoignable — DNS, démarrage à froid trop long — fait échouer
    // `fetch`. Sans cette garde, l'appelant recevrait la page d'erreur HTML de
    // Next là où il attend du JSON, et l'erreur serait illisible.
    throw new Error(`batch trigger unreachable: ${(error as Error).message}`);
  }

  const body = (await response.json().catch(() => ({}))) as {
    execution?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || `batch trigger returned ${response.status}`);
  }
  return { execution: body.execution ?? "", origin: "cloud-run" };
}
