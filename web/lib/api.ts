import type {
  CostEstimate,
  EvalRunConfig,
  EvalRunRecord,
  JudgePromptPreview,
  ProviderInfo,
  SelectedScenario,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

/** Une erreur de validation pydantic, telle que FastAPI la sérialise. */
interface ValidationDetail {
  loc?: unknown[];
  msg?: string;
}

/** Rend lisible le corps d'une réponse d'erreur, plutôt que d'afficher du JSON brut. */
function readableDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim() !== "") return detail;
  if (Array.isArray(detail)) {
    const parts = (detail as ValidationDetail[])
      .map((item) => {
        const field = Array.isArray(item.loc)
          ? item.loc.filter((p) => p !== "body").join(".")
          : "";
        return field ? `${field}: ${item.msg ?? ""}` : (item.msg ?? "");
      })
      .filter(Boolean);
    if (parts.length) return parts.join(" · ");
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      message = readableDetail(JSON.parse(raw).detail) ?? raw;
    } catch {
      /* la réponse n'est pas du JSON : on garde le corps brut */
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const getCatalog = () => request<ProviderInfo[]>("/api/catalog");
export const getSelected = () => request<SelectedScenario[]>("/api/selected");
export const getEvalRuns = () => request<EvalRunRecord[]>("/api/eval-runs");
export const getEvalRun = (runId: string) =>
  request<EvalRunRecord>(`/api/eval-runs/${runId}`);

export const createEvalRun = (config: EvalRunConfig) =>
  request<EvalRunRecord>("/api/eval-runs", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const cancelEvalRun = (runId: string) =>
  request<EvalRunRecord>(`/api/eval-runs/${runId}/cancel`, { method: "POST" });

export const estimateRun = (config: EvalRunConfig) =>
  request<CostEstimate>("/api/eval-runs/estimate", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const previewJudgePrompt = (criterion: string) =>
  request<JudgePromptPreview>("/api/judge-prompt-preview", {
    method: "POST",
    body: JSON.stringify({ criterion }),
  });

/** URL d'un export CSV. Le navigateur télécharge : pas de fetch intermédiaire. */
export function exportUrl(runId: string, kind: "matrix" | "details"): string {
  return `${BASE}/api/eval-runs/${runId}/export/${kind}.csv`;
}

/** Le CSV de la matrice en texte, pour le presse-papier.
 *
 * Ne passe pas par `request`, qui attend du JSON. Le BOM que sert la route
 * est là pour Excel ; collé dans un éditeur il apparaîtrait comme un
 * caractère parasite en tête de fichier. */
export async function matrixCsvText(runId: string): Promise<string> {
  const response = await fetch(exportUrl(runId, "matrix"), { cache: "no-store" });
  if (!response.ok) throw new Error(`Export failed (HTTP ${response.status})`);
  return (await response.text()).replace(/^\ufeff/, "");
}

export const saveNotes = (runId: string, notes: string) =>
  request<EvalRunRecord>(`/api/eval-runs/${runId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });
