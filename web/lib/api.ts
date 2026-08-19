import type {
  EvalRunConfig,
  EvalRunRecord,
  ProviderInfo,
  SelectedScenario,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

/** Une erreur de validation pydantic, telle que FastAPI la sérialise dans `detail`. */
type PydanticValidationError = {
  loc?: unknown[];
  msg?: string;
};

/**
 * Construit un message lisible à partir du champ `detail` d'une réponse
 * d'erreur JSON du backend.
 *
 * `detail` est soit une chaîne (nos propres `HTTPException`, déjà en
 * français), soit une liste d'erreurs de validation pydantic (issues de la
 * validation automatique du corps de requête par FastAPI). Retourne `null`
 * quand `detail` n'a aucune de ces deux formes, pour laisser l'appelant
 * retomber sur le corps brut.
 */
function readableDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim() !== "") {
    return detail;
  }
  if (Array.isArray(detail)) {
    const messages = detail
      .map((entry) => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          typeof (entry as PydanticValidationError).msg !== "string"
        ) {
          return null;
        }
        const { loc, msg } = entry as PydanticValidationError;
        const field = Array.isArray(loc)
          ? loc.filter((part) => part !== "body").join(".")
          : "";
        return field ? `${field} : ${msg}` : msg;
      })
      .filter((message): message is string => message !== null);
    if (messages.length > 0) {
      return messages.join(" ; ");
    }
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
    const body = await response.text();
    let message = `${response.status} ${response.statusText} — ${body}`;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      const readable = readableDetail(parsed?.detail);
      if (readable) {
        message = readable;
      }
    } catch {
      // Le corps n'est pas du JSON exploitable : on garde le message brut.
    }
    throw new Error(message);
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
