// Un run soumis en YAML par l'outil MCP submit_draft_run, sauvegardé sans
// être lancé — le geste de lancer reste un clic humain, sur la page que
// createDraft rend adressable.
import "server-only";
import { DRAFTS, NOW, insert, rpc, select, update } from "./supabase";
import type { Draft, EvalRunConfig } from "./types";

export class DraftNotFound extends Error {}

export type { Draft };

/** Enregistrer un brouillon.
 *
 * `origin` est demandé plutôt que deviné : c'est ce qui dit, en le rouvrant,
 * si une configuration incomplète est une anomalie ou l'état normal du
 * travail. L'outil MCP ne dépose que du valide — il valide avant — quand le
 * formulaire dépose ce qu'il a sous la main. */
export async function createDraft(
  config: EvalRunConfig,
  csvText: string | null,
  createdBy: string,
  origin: "manual" | "mcp",
): Promise<string> {
  const rows = await insert<Draft>(
    DRAFTS,
    { config, csv_text: csvText, created_by: createdBy, origin },
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
  // Un brouillon lancé reste ouvrable — on peut vouloir relancer la même
  // chose. Un brouillon jeté, non : lui seul disparaît de cette lecture.
  const rows = await select<Draft>(DRAFTS, {
    id: `eq.${id}`,
    select: "*",
    deleted_at: "is.null",
    limit: 1,
  });
  const draft = rows[0];
  if (!draft) throw new DraftNotFound(`Unknown draft: ${id}`);
  return draft;
}

/** Tous les brouillons en attente, du plus récent au plus ancien.
 *
 * Sans filtre sur l'auteur : un brouillon est une proposition faite à
 * l'équipe, comme un run l'est une fois lancé — tout le monde voit tout. */
export async function loadDrafts(): Promise<Draft[]> {
  await sweepStaleDrafts();
  return select<Draft>(DRAFTS, {
    select: "*",
    // Ce qui attend : ni lancé, ni jeté.
    deleted_at: "is.null",
    launched_at: "is.null",
    order: "created_at.desc",
  });
}

/** Réécrire un brouillon en place, depuis le formulaire.
 *
 * Rouvrir un brouillon, le corriger et l'enregistrer doit le remplacer, pas en
 * semer un second : la liste d'attente ne veut pas de doublons dont on ne
 * saurait plus lequel est le bon.
 *
 * Il repasse `manual`, même s'il venait d'un agent. La pastille ne dit pas qui
 * l'a créé mais si son contenu a été validé : `submit_draft_run` ne dépose que
 * du valide, et cette garantie tombe dès qu'une main réécrit la configuration
 * sans repasser par là. Garder `mcp` ferait mentir la pastille précisément où
 * elle sert — devant un brouillon incomplet, à décider si c'est une anomalie
 * ou le travail en cours. La provenance d'origine se perd ; c'est le prix, et
 * elle disait moins que la garantie.
 *
 * D'où le paramètre plutôt qu'une constante : `update_draft_run` valide avant
 * d'écrire, exactement comme `submit_draft_run`, et la garantie tient donc
 * encore après son passage. Le défaut reste `manual` — c'est le formulaire qui
 * appelle le plus souvent, et c'est lui qui ne garantit rien. */
export async function updateDraft(
  id: string,
  config: EvalRunConfig,
  csvText: string | null,
  origin: "manual" | "mcp" = "manual",
): Promise<void> {
  await update(
    DRAFTS,
    { config, csv_text: csvText, origin },
    { id: `eq.${id}` },
  );
}

/** Jeter un brouillon : il sort de la liste, et son adresse ne répond plus. */
export async function discardDraft(id: string): Promise<void> {
  await update(DRAFTS, { deleted_at: NOW }, { id: `eq.${id}` });
}

/** Marquer un brouillon comme lancé, et dire ce qu'il a produit.
 *
 * Il sort de la liste d'attente — il a servi — mais son adresse reste
 * ouverte : rouvrir un brouillon lancé pour relancer la même chose est un
 * geste légitime. `launched_run_id` répond après coup à « d'où vient ce
 * run », que la disparition pure et simple rendait impossible. */
export async function markDraftLaunched(
  id: string,
  runId: string,
): Promise<void> {
  await update(
    DRAFTS,
    { launched_at: NOW, launched_run_id: runId },
    { id: `eq.${id}` },
  );
}
