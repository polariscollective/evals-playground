// The browser's access to the application. Everything goes through the `/api`
// routes of this same application: the browser never talks to Supabase, and
// therefore never sees the service key.
import type {
  CostEstimate,
  Draft,
  DraftRead,
  EvalRunConfig,
  ExpectedCsv,
  JudgePromptPreview,
  ExtendRequest,
  JudgeSpec,
  Profile,
  ProfileActivity,
  ProviderInfo,
  RubricLevel,
  RunDetail,
  RunListItem,
  Tag,
} from "./types";
import { PLAIN_VIEW, viewToQuery, type MatrixView } from "./view";
import type { AdviceTopic } from "./advice";

/** Makes an error response's body readable, rather than showing raw JSON. */
async function readError(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    /* the response is not JSON: we keep the raw body */
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

/** Reads a run described in a JSON or YAML file.
 *
 * The text goes to the server rather than being parsed here: the YAML parser
 * stays out of the browser bundle, and the validation applied is the one used
 * at launch. */
export const importConfigFile = (text: string) =>
  request<{ config: EvalRunConfig; csv: ExpectedCsv | null }>("/api/config", {
    method: "POST",
    body: JSON.stringify({ text }),
  });

/** Writes the form's configuration in YAML, the format the prompt asks the
 *  agent for — one format for both directions. */
export const exportConfigFile = (config: EvalRunConfig) =>
  request<{ text: string }>("/api/config", {
    method: "PUT",
    body: JSON.stringify({ config }),
  });
export const getRuns = () => request<RunListItem[]>("/api/runs");

/** Renames a run. An empty string restores the default title. */
export const saveRunLabel = (runId: string, label: string) =>
  request<{ ok: true; label: string | null }>(`/api/runs/${runId}/label`, {
    method: "PUT",
    body: JSON.stringify({ label }),
  });

/** A run and its cells.
 *
 * Without `withTranscripts`, the conversations are not brought back: that is
 * what makes a refresh every three seconds bearable while a run is going.
 *
 * `withFullJudgeScores`, independent of `withTranscripts`: brings back the
 * verdicts of every living judge rather than only those of the principal and of
 * the awareness one, without loading the conversations — necessary as soon as a
 * secondary judge is shown (see `app/eval/[runId]/page.tsx`), without which the
 * matrix shows "pending" everywhere for a judge that has graded everything. */
export const getRun = (
  runId: string,
  options: { withTranscripts?: boolean; withFullJudgeScores?: boolean } = {},
) => {
  const params = new URLSearchParams();
  if (options.withTranscripts) params.set("transcripts", "1");
  if (options.withFullJudgeScores) params.set("full_judges", "1");
  const query = params.toString();
  return request<RunDetail>(`/api/runs/${runId}${query ? `?${query}` : ""}`);
};

/** Launches a run. The uploaded CSV is kept, to download it again and to
 * relaunch from the same source. */
/** `draftId` says where the run comes from, when the form was open on a draft.
 *  It opens no right — it only attributes a provenance. */
export const createRun = (
  config: EvalRunConfig,
  csvText?: string | null,
  draftId?: string | null,
) =>
  request<{ run_id: string }>("/api/runs", {
    method: "POST",
    body: JSON.stringify({ config, csv_text: csvText ?? null, draft_id: draftId ?? null }),
  });

/** Adds a secondary judge to a run — never a principal. What "re-judging" has
 *  become since the multiple judges: one more judge is added, the old one's
 *  verdict is no longer overwritten. */
export const addRunJudge = (runId: string, spec: JudgeSpec) =>
  request<{ ok: true; run_judge_id: string }>(`/api/runs/${runId}/judges`, {
    method: "POST",
    body: JSON.stringify(spec),
  });

/** Unlinks a judge from a run. `replacementRunJudgeId`: required to unlink the
 *  principal as long as other judges are still alive — the database refuses it
 *  otherwise (see `PrincipalRequiresReplacement`, `lib/runs.ts`). */
export const unlinkRunJudge = (
  runId: string,
  runJudgeId: string,
  replacementRunJudgeId: string | null = null,
) =>
  request<{ ok: true }>(`/api/runs/${runId}/judges/${runJudgeId}`, {
    method: "DELETE",
    body: JSON.stringify({ replacement_run_judge_id: replacementRunJudgeId }),
  });

/** Designates a run's principal: the one the matrix shows. */
export const designateRunPrincipal = (runId: string, runJudgeId: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/judges/${runJudgeId}/principal`, {
    method: "POST",
  });

/** Fills in this run's pending score rows — the old awareness button,
 *  generalised to any judge. With no body: the job finds what is left on its
 *  own. */
export const catchUp = (runId: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/catchup`, { method: "POST" });

export const cancelRun = (runId: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/cancel`, { method: "POST" });

/** Replays the cells in error, within that same run. */
export const retryFailedCells = (runId: string) =>
  request<{ ok: true; retried: number }>(`/api/runs/${runId}/retry`, {
    method: "POST",
  });

/** Adds a sub-matrix to a run: scenarios, models, attempts.
 *
 * `draftId` when this extension applies a draft: the route uses it to refuse a
 * draft already applied, and to mark it launched itself once the extension has
 * gone. */
export const extendRun = (
  runId: string,
  body: ExtendRequest,
  draftId?: string | null,
) =>
  request<{ ok: true; added: number }>(
    `/api/runs/${runId}/extend${draftId ? `?draft=${encodeURIComponent(draftId)}` : ""}`,
    { method: "POST", body: JSON.stringify(body) },
  );

/** Sets aside an extension composed by hand, without applying it to the run —
 *  the same gesture as "Save as draft" on the composition form, to enlarge an
 *  existing run rather than launch a new one. */
export const saveExtendDraft = (runId: string, extension: ExtendRequest) =>
  request<{ id: string }>(`/api/runs/${runId}/extend/draft`, {
    method: "POST",
    body: JSON.stringify({ config: extension }),
  });

export const saveNotes = (runId: string, notes: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/notes`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });

/** The content of a draft submitted by an agent, to open the form or the
 *  extension panel on it rather than show it on a separate page. Also carries
 *  `mine` — computed by the route, never compared here: the browser does not
 *  know the address of whoever is looking. */
export const getDraft = (draftId: string) =>
  request<DraftRead>(`/api/runs/drafts/${draftId}`);

/** The address of whoever is looking, so as to filter "mine". */
export const getMe = () => request<{ email: string }>("/api/me");

/** The waiting drafts, whoever they belong to. `withLaunched` adds those that
 *  have already served — one may want to relaunch the same thing. */
export const getDrafts = (withLaunched = false) =>
  request<Draft[]>(`/api/runs/drafts${withLaunched ? "?launched=1" : ""}`);

/** Sets the form aside, valid or not. Returns the draft's identifier. */
export const saveDraft = (config: EvalRunConfig, csvText: string | null) =>
  request<{ id: string }>("/api/runs/drafts", {
    method: "POST",
    body: JSON.stringify({ config, csv_text: csvText }),
  });

/** Rewrites a reopened draft — in place for its author, replacing rather than
 *  sowing a second one. For anyone else, the rewrite lays down a new draft
 *  instead: `forked` says so, with the address to follow — the original stays
 *  intact. Serves a run draft as well as an extension draft: the route reads the
 *  kind from the one it has in the database. */
export const updateDraft = (
  draftId: string,
  config: EvalRunConfig | ExtendRequest,
  csvText: string | null,
) =>
  request<{ ok: true; forked: boolean; draft_id: string }>(
    `/api/runs/drafts/${draftId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ config, csv_text: csvText }),
    },
  );

/** Discards a draft: it leaves the list and its address stops answering. */
export const discardDraft = (draftId: string) =>
  request<{ ok: true }>(`/api/runs/drafts/${draftId}`, { method: "DELETE" });

/** Marks a draft as launched. Its address stays open, unlike the bin; what it
 *  produced is read on the run. */
export const markDraftLaunched = (draftId: string) =>
  request<{ ok: true }>(`/api/runs/drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify({ launched: true }),
  });

/** Sets a run aside from the lists and from public reading. Nothing is erased. */
export const softDeleteRun = (runId: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/delete`, { method: "POST" });

/** Written afterwards, distinct from the notes, which are the preamble. */
export const saveAnalysis = (runId: string, analysis: string) =>
  request<{ ok: true }>(`/api/runs/${runId}/analysis`, {
    method: "PUT",
    body: JSON.stringify({ analysis }),
  });

/** Publishes a run, or unpublishes it. Returns the public address, or null. */
export const publishRun = (runId: string, isPublic: boolean) =>
  request<{ ok: true; url: string | null }>(`/api/runs/${runId}/publish`, {
    method: "POST",
    body: JSON.stringify({ public: isPublic }),
  });

export const getTags = () => request<Tag[]>("/api/tags");

/** The tags of every run and every draft, in a single call — what the runs
 *  list shows as pills on each row. One request per row would be absurd for a
 *  list holding dozens of them. */
export const getTagAssignments = () =>
  request<{ runs: Record<string, Tag[]>; drafts: Record<string, Tag[]> }>(
    "/api/tags/assignments",
  );

/** Creates a tag, or returns the one that already carries this label — the
 *  route does not distinguish the two cases, and the caller has no need for it
 *  to. */
export const createTag = (label: string) =>
  request<Tag>("/api/tags", {
    method: "POST",
    body: JSON.stringify({ label }),
  });

export const getRunTags = (runId: string) =>
  request<Tag[]>(`/api/runs/${runId}/tags`);

/** Lays down a run's list of tags, as it stands: what it held before is
 *  replaced, not completed. */
export const setRunTags = (runId: string, tagIds: number[]) =>
  request<{ ok: true }>(`/api/runs/${runId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tag_ids: tagIds }),
  });

/** Twin of `setRunTags`, for a draft rather than a run. */
export const setDraftTags = (draftId: string, tagIds: number[]) =>
  request<{ ok: true }>(`/api/runs/drafts/${draftId}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tag_ids: tagIds }),
  });

/** Estimates a run. The assumed length travels in the config. */
export const estimateRun = (config: EvalRunConfig) =>
  request<CostEstimate>("/api/estimate", {
    method: "POST",
    body: JSON.stringify(config),
  });

export const previewJudgePrompt = (criterion: string, rubric: RubricLevel[]) =>
  request<JudgePromptPreview>("/api/judge-prompt", {
    method: "POST",
    body: JSON.stringify({ criterion, rubric }),
  });

/** URL of a CSV export. The browser downloads: no intermediate fetch. */
export function exportUrl(
  runId: string,
  kind: "matrix" | "details",
  view: MatrixView = PLAIN_VIEW,
): string {
  // The details carry the judge's raw grades: rereading them any other way
  // would make no sense, and sticking a view in the URL would suggest otherwise.
  const query = kind === "matrix" ? viewToQuery(view) : "";
  return `/api/runs/${runId}/export/${kind}${query}`;
}

/** Inspect's viewer, opened on a run's logs. */
export function inspectViewUrl(runId: string): string {
  return `/inspect-view/${runId}`;
}

/** Does this run have logs to show?
 *
 * The question is asked of the manifest, and not of a dedicated route. Two
 * reasons. It goes up last, so its presence says the logs preceded it; and the
 * viewer refuses a folder that has none — the button therefore appears only when
 * it leads somewhere. It lives under `/inspect-view`, already open to the public
 * and already guarded by `canReadRun`, which means a stranger in front of a
 * published run asks the same question as its owner.
 *
 * False on a breakdown as much as on an absence: a button that does not appear
 * is better than a button that leads to an empty page. */
export async function hasInspectLogs(runId: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${inspectViewUrl(runId)}/logs/listing.json`,
      { cache: "no-store" },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export function sourceCsvUrl(runId: string): string {
  return `/api/runs/${runId}/source`;
}

/** The original CSV as text, to start again from the same batch in the form. */
export async function sourceCsvText(runId: string): Promise<string> {
  const response = await fetch(sourceCsvUrl(runId), { cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.text()).replace(/^﻿/, "");
}

/** The matrix CSV as text, for the clipboard.
 *
 * Does not go through `request`, which expects JSON. The BOM the route serves is
 * there for Excel; pasted into an editor it would appear as a stray character at
 * the head of the file. */
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
  last_used_at: string | null;
  client_label: string | null;
  /** `authorization_code`: born of a full authorisation round.
   *  `refresh_token`: born of a rotation, hence of a chain that lives on. */
  born: "authorization_code" | "refresh_token";
}

export const listMcpConnections = () => request<McpGrant[]>("/api/mcp/connections");

export const revokeMcpConnection = (accessTokenHash: string) =>
  request<{ ok: true }>("/api/mcp/connections", {
    method: "DELETE",
    body: JSON.stringify({ access_token_hash: accessTokenHash }),
  });

/** Cut everything off. Bounded to the session's email on the route side, never
 *  here. */
export const revokeAllMcpConnections = () =>
  request<{ ok: true; revoked: number }>("/api/mcp/connections", {
    method: "DELETE",
    body: JSON.stringify({ all: true }),
  });

/** The profile of whoever is looking: their two caps, and what an agent has
 *  launched on their behalf over the hour just past. */
export const getProfile = () =>
  request<{ profile: Profile; activity: ProfileActivity }>("/api/profile");

/** Changes the two caps. Bounded to the session's email on the route side,
 *  never here — like the MCP connections. */
export const updateProfileCaps = (caps: {
  max_usd_per_run: number;
  max_usd_per_hour: number;
}) =>
  request<{ profile: Profile }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify(caps),
  });

/** Writes the advice override, or `null` to restore the default. */
export const updateScenarioAdvice = (advice: string | null) =>
  updateAdvice("scenario", advice);

/** Writes the override of ONE advice document. `null` puts the default back.
 *
 * `topic` travels beside the text rather than being four routes: it is the same
 * gesture on the same profile, and the route applies one setting at a time
 * anyway — see `profilePatchProblem`. */
export const updateAdvice = (topic: AdviceTopic, advice: string | null) =>
  request<{ profile: Profile }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ advice_topic: topic, scenario_advice: advice }),
  });

/** Writes the favourites of whoever is signed in. Sent alone: the route applies
 *  one setting at a time — see `profilePatchProblem`. */
export const updateProfileFavorites = (favorite_models: string[]) =>
  request<{ profile: Profile }>("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({ favorite_models }),
  });
