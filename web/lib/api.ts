// L'accès du navigateur à l'application. Tout passe par les routes `/api` de
// cette même application : le navigateur ne parle jamais à Supabase, et ne voit
// donc jamais la clé de service.
import type {
  CostEstimate,
  EvalRunConfig,
  ExpectedCsv,
  JudgePromptPreview,
  ExtendRequest,
  ProviderInfo,
  RejudgeRequest,
  RubricLevel,
  RunDetail,
  RunSummary,
} from "./types";
import { PLAIN_VIEW, viewToQuery, type MatrixView } from "./view";

/** Rend lisible le corps d'une réponse d'erreur, plutôt que d'afficher du JSON brut. */
async function readError(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    /* la réponse n'est pas du JSON : on garde le corps brut */
  }
  return raw || `HTTP ${response.status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readError(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const getCatalog = () => request<ProviderInfo[]>("/api/catalog");

/** Lit un run décrit dans un fichier JSON ou YAML.
 *
 * Le texte part au serveur plutôt que d'être analysé ici : l'analyseur YAML
 * reste hors du paquet du navigateur, et la validation appliquée est celle du
 * lancement. */
export const importConfigFile = (text: string) =>
  request<{ config: EvalRunConfig; csv: ExpectedCsv | null }>("/api/config", {
    method: "POST",
    body: JSON.stringify({ text }),
  });

/** Écrit la configuration du formulaire en YAML, le format que le prompt
 *  demande à l'agent — un seul format pour les deux sens. */
export const exportConfigFile = (config: EvalRunConfig) =>
  request<{ text: string }>("/api/config", {
    method: "PUT",
    body: JSON.stringify({ config }),
  });
export const getRuns = () => request<RunSummary[]>("/api/runs");

/** Un run et ses cases.
 *
 * Sans `withTranscripts`, les conversations ne sont pas ramenées : c'est ce qui
 * rend supportable un rafraîchissement toutes les trois secondes pendant qu'un
 * run tourne. */
export const getRun = (runId: string, withTranscripts = false) =>
  request<RunDetail>(
    `/api/runs/${runId}${withTranscripts ? "?transcripts=1" : ""}`,
  );

/** Lance un run. Le CSV téléversé est conservé, pour le retélécharger et pour
 * relancer depuis la même source. */
export const createRun = (config: EvalRunConfig, csvText?: string | null) =>
  request<{ run_id: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ config, csv_text: csvText ?? null }),
  });

export const rejudgeRun = (runId: string, body: RejudgeRequest) =>
  request<{ ok: true }>(`/api/runs/${runId}/rejudge`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const cancelRun = (runId: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/cancel`, { method: "POST" });

/** Relance les cases en erreur, dans ce même run. */
export const retryFailedCells = (runId: string) =>
  request<{ ok: true; retried: number }>(`/api/runs/${runId}/retry`, {
    method: "POST",
  });

/** Ajoute une sous-matrice à un run : des scénarios, des modèles, des essais. */
export const extendRun = (runId: string, body: ExtendRequest) =>
  request<{ ok: true; added: number }>(`/api/runs/${runId}/extend`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const saveNotes = (runId: string, notes: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });

/** Le contenu d'un brouillon soumis par un agent, pour ouvrir le formulaire
 *  dessus plutôt que de le montrer dans une page à part. */
export const getDraft = (draftId: string) =>
  request<{ config: EvalRunConfig; csv_text: string | null }>(
    `/api/runs/drafts/${draftId}`,
  );

/** Écrite après coup, distincte des notes qui sont le préambule. */
export const saveAnalysis = (runId: string, analysis: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/analysis`, {
    method: "PUT",
    body: JSON.stringify({ analysis }),
  });

/** Publie un run, ou le dépublie. Rend l'adresse publique, ou null. */
export const publishRun = (runId: string, isPublic: boolean) =>
  request<{ ok: true; url: string | null }>(`/api/runs/${runId}/publish`, {
    method: "POST",
    body: JSON.stringify({ public: isPublic }),
  });

/** Estime un run. Sans `responseTokens`, chaque modèle prend sa longueur mesurée. */
export const estimateRun = (
  config: EvalRunConfig,
  responseTokens?: number | null,
) =>
  request<CostEstimate>(
    responseTokens == null
      ? "/api/estimate"
      : `/api/estimate?response_tokens=${responseTokens}`,
    { method: "POST", body: JSON.stringify(config) },
  );

export const previewJudgePrompt = (criterion: string, rubric: RubricLevel[]) =>
  request<JudgePromptPreview>("/api/judge-prompt", {
    method: "POST",
    body: JSON.stringify({ criterion, rubric }),
  });

/** URL d'un export CSV. Le navigateur télécharge : pas de fetch intermédiaire. */
export function exportUrl(
  runId: string,
  kind: "matrix" | "details",
  view: MatrixView = PLAIN_VIEW,
): string {
  // Le détail porte les notes brutes du juge : le relire autrement n'aurait pas
  // de sens, et lui coller une vue dans l'URL laisserait croire le contraire.
  const query = kind === "matrix" ? viewToQuery(view) : "";
  return `/api/runs/${runId}/export/${kind}${query}`;
}

export function sourceCsvUrl(runId: string): string {
  return `/api/runs/${runId}/source`;
}

/** Le CSV d'origine en texte, pour repartir du même lot dans le formulaire. */
export async function sourceCsvText(runId: string): Promise<string> {
  const response = await fetch(sourceCsvUrl(runId), { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.text()).replace(/^﻿/, "");
}

/** Le CSV de la matrice en texte, pour le presse-papier.
 *
 * Ne passe pas par `request`, qui attend du JSON. Le BOM que sert la route est
 * là pour Excel ; collé dans un éditeur il apparaîtrait comme un caractère
 * parasite en tête de fichier. */
export async function matrixCsvText(
  runId: string,
  view: MatrixView = PLAIN_VIEW,
): Promise<string> {
  const response = await fetch(exportUrl(runId, "matrix", view), {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.text()).replace(/^﻿/, "");
}

export interface McpGrant {
  access_token_hash: string;
  user_email: string;
  created_at: string;
  refresh_expires_at: string;
}

export const listMcpConnections = () => request<McpGrant[]>("/api/mcp/connections");

export const revokeMcpConnection = (accessTokenHash: string) =>
  request<{ ok: true }>("/api/mcp/connections", {
    method: "DELETE",
    body: JSON.stringify({ access_token_hash: accessTokenHash }),
  });
