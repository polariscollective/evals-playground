// Un run soumis en YAML par l'outil MCP submit_draft_run, sauvegardé sans
// être lancé — le geste de lancer reste un clic humain, sur la page que
// createDraft rend adressable.
import "server-only";
import { DRAFTS, DRAFT_TAGS, NOW, insert, remove, rpc, select, update } from "./supabase";
import type { Draft, EvalRunConfig, ExtendRequest } from "./types";

export class DraftNotFound extends Error {}

export type { Draft };

/** Enregistrer un brouillon.
 *
 * `origin` est demandé plutôt que deviné : c'est ce qui dit, en le rouvrant,
 * si une configuration incomplète est une anomalie ou l'état normal du
 * travail. L'outil MCP ne dépose que du valide — il valide avant — quand le
 * formulaire dépose ce qu'il a sous la main. */
/** Proposer d'agrandir un run, sans y toucher.
 *
 * Rien n'est appliqué au run : ni les modèles, ni les scénarios, ni les outils
 * que la demande propose d'ajouter. Le brouillon ne porte qu'une intention, et
 * c'est le panneau d'extension qui l'exécute après confirmation — un brouillon
 * qu'on jette doit laisser le run exactement comme il était. */
export async function createExtendDraft(
  runId: string,
  request: ExtendRequest,
  createdBy: string,
  origin: "manual" | "mcp",
): Promise<string> {
  const rows = await insert<Draft>(
    DRAFTS,
    {
      kind: "extend",
      extends_run_id: runId,
      config: request,
      csv_text: null,
      created_by: createdBy,
      origin,
    },
    { returning: true },
  );
  return rows[0].id;
}

export async function createDraft(
  config: EvalRunConfig,
  csvText: string | null,
  createdBy: string,
  origin: "manual" | "mcp",
): Promise<string> {
  const rows = await insert<Draft>(
    DRAFTS,
    { kind: "run", config, csv_text: csvText, created_by: createdBy, origin },
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
 * l'équipe, comme un run l'est une fois lancé — tout le monde voit tout.
 *
 * `withLaunched` rouvre la liste à ceux qui ont déjà servi. Ils en sortent par
 * défaut parce que la liste d'attente est faite pour ce qui attend ; mais ils
 * gardent leur adresse, et relancer la même chose est un geste prévu — encore
 * faut-il pouvoir les retrouver. Les jetés, eux, ne reviennent jamais. */
export async function loadDrafts(
  options: { withLaunched?: boolean } = {},
): Promise<Draft[]> {
  await sweepStaleDrafts();
  return select<Draft>(DRAFTS, {
    select: "*",
    deleted_at: "is.null",
    ...(options.withLaunched ? {} : { launched_at: "is.null" }),
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

/** Jeter un brouillon : il sort de la liste, et son adresse ne répond plus.
 *
 * Ses liens de tags sont retirés à la suite : un tag ne survit que porté par
 * quelque chose de vivant, et un brouillon jeté ne l'est plus. C'est ce qui
 * fait tenir « détaché partout = supprimé » même pour ce qui part à la
 * corbeille — le déclencheur `delete_orphan_tag` supprime le tag si ce lien
 * était le dernier.
 *
 * `deleted_at` d'abord, le retrait ensuite : si celui-ci échoue, le brouillon
 * reste jeté avec ses tags encore accrochés, sans conséquence — l'inverse
 * détacherait les tags d'un brouillon qui, si la suppression suivante
 * échouait, ne serait même pas jeté. */
export async function discardDraft(id: string): Promise<void> {
  await update(DRAFTS, { deleted_at: NOW }, { id: `eq.${id}` });
  await remove(DRAFT_TAGS, { draft_id: `eq.${id}` });
}

/** Marquer un brouillon comme lancé.
 *
 * Il sort de la liste d'attente — il a servi — mais son adresse reste
 * ouverte : rouvrir un brouillon lancé pour relancer la même chose est un
 * geste légitime, et `launched_at` dit donc le *dernier* lancement.
 *
 * Ce qu'il a produit ne se note plus ici. Une case unique ne peut pas tenir
 * plusieurs runs, et le second lancement effaçait le premier : c'est
 * `eval_runs.draft_id` qui porte le lien, autant de fois qu'il le faut. */
export async function markDraftLaunched(id: string): Promise<void> {
  await update(DRAFTS, { launched_at: NOW }, { id: `eq.${id}` });
}
