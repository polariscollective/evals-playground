// Un run soumis en YAML par l'outil MCP submit_draft_run, sauvegardé sans
// être lancé — le geste de lancer reste un clic humain, sur la page que
// createDraft rend adressable.
import "server-only";
import { DRAFTS, insert, remove, rpc, select } from "./supabase";
import type { EvalRunConfig } from "./types";

export class DraftNotFound extends Error {}

export interface Draft {
  id: string;
  config: EvalRunConfig;
  csv_text: string | null;
  created_by: string;
  created_at: string;
}

export async function createDraft(
  config: EvalRunConfig,
  csvText: string | null,
  createdBy: string,
): Promise<string> {
  const rows = await insert<Draft>(
    DRAFTS,
    { config, csv_text: csvText, created_by: createdBy },
    { returning: true },
  );
  return rows[0].id;
}

let lastSweep = 0;

/** Efface les brouillons oubliés avant toute lecture — même patron que
 *  `failStaleRuns`, avec un intervalle plus large : un brouillon abandonné
 *  n'est pas urgent à ramasser. */
async function sweepStaleDrafts(): Promise<void> {
  const now = Date.now();
  if (now - lastSweep < 5 * 60 * 1000) return;
  lastSweep = now;
  try {
    await rpc("sweep_stale_eval_run_drafts");
  } catch (error) {
    console.error("sweep_stale_eval_run_drafts:", (error as Error).message);
  }
}

/** Throws: DraftNotFound si aucun brouillon ne porte cet identifiant. */
export async function loadDraft(id: string): Promise<Draft> {
  await sweepStaleDrafts();
  const rows = await select<Draft>(DRAFTS, { id: `eq.${id}`, select: "*", limit: 1 });
  const draft = rows[0];
  if (!draft) throw new DraftNotFound(`Unknown draft: ${id}`);
  return draft;
}

export async function deleteDraft(id: string): Promise<void> {
  await remove(DRAFTS, { id: `eq.${id}` });
}
