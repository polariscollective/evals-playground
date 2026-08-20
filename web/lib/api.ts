// L'accès du navigateur à l'application. Tout passe par les routes `/api` de
// cette même application : le navigateur ne parle jamais à Supabase, et ne voit
// donc jamais la clé de service.
import type {
  CostEstimate,
  EvalRunConfig,
  JudgePromptPreview,
  ProviderInfo,
  RejudgeRequest,
  RubricLevel,
  RunDetail,
  RunSummary,
} from "./types";

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

export const saveNotes = (runId: string, notes: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
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
export function exportUrl(runId: string, kind: "matrix" | "details"): string {
  return `/api/runs/${runId}/export/${kind}`;
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
export async function matrixCsvText(runId: string): Promise<string> {
  const response = await fetch(exportUrl(runId, "matrix"), { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.text()).replace(/^﻿/, "");
}
