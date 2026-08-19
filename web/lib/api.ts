import type {
  EvalRunConfig,
  EvalRunRecord,
  ProviderInfo,
  SelectedScenario,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${response.status} ${response.statusText} — ${detail}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const getCatalog = () => request<ProviderInfo[]>("/api/catalog");

export const getSelected = () => request<SelectedScenario[]>("/api/selected");

export const createEvalRun = (config: EvalRunConfig) =>
  request<EvalRunRecord>("/api/eval-runs", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const getEvalRuns = () => request<EvalRunRecord[]>("/api/eval-runs");

export const getEvalRun = (runId: string) =>
  request<EvalRunRecord>(`/api/eval-runs/${runId}`);

export const cancelEvalRun = (runId: string) =>
  request<EvalRunRecord>(`/api/eval-runs/${runId}/cancel`, { method: "POST" });
