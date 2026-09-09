// Searching for a run among those already loaded — no new request.
//
// `search_runs` (the MCP connector) answers "have you already seen a run about
// this?". The filtering happens here, in TypeScript, on what `loadRuns` has
// already brought back: the agent's keyword never touches a PostgREST filter
// expression, and this function stays pure — and so one of the rare parts of the
// connector `node --test` really covers. No `server-only` here: `route.ts` loads
// the runs, this function does nothing but sort them and slice them.
import type { EvalRun, RunStatus, RunSummary, Tag } from "./types";

/** A short card — never the whole notes nor the matrix. The agent calls
 *  `get_run_metadata` or `get_run_results` back on what it keeps. */
export interface SearchHit {
  id: string;
  label: string | null;
  status: RunStatus;
  created_at: string;
  finished_at: string | null;
  targets: string[];
  scenario_count: number;
  total_samples: number;
  mean: number | null;
  cost_usd: number | null;
  /** The labels of the run's tags, in the order `tagsByRun` carries them — never
   *  the colour: an agent paints nothing. Empty if the run has none. */
  tags: string[];
  /** Only if a query was given: the fields that carry it. */
  matched_in?: MatchedField[];
  /** Only if a query was given: the text around the first occurrence, in the
   *  first field of `FIELDS` that matches. */
  snippet?: string;
}

export interface SearchOptions {
  query?: string;
  limit?: number;
  status?: string;
  /** Keep only the runs carrying this tag label, case-insensitively, on exact
   *  equality — never as a substring: `api` must not bring back a `rapide`
   *  tag. */
  tag?: string;
}

/** A run's tags, by run identifier — the shape `tagsByRun()` (`lib/tags.ts`)
 *  returns. Passed as an argument rather than imported: this module stays pure,
 *  loadable by `node --test`, and `lib/tags.ts` is `server-only`. */
export type RunTags = Map<string, Tag[]>;

type MatchedField = "label" | "notes" | "analysis" | "criterion";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Where to search, and in what order: it is also the priority order of the
 *  snippet — the first field that matches supplies the excerpt. */
const FIELDS: { field: MatchedField; text: (run: EvalRun) => string }[] = [
  { field: "label", text: (run) => run.label ?? "" },
  { field: "criterion", text: (run) => run.config.criterion ?? "" },
  { field: "notes", text: (run) => run.notes ?? "" },
  { field: "analysis", text: (run) => run.analysis ?? "" },
];

const SNIPPET_BEFORE = 80;
const SNIPPET_AFTER = 120;
const SNIPPET_MAX = 250;

/** The recent runs, or those whose text carries `query`.
 *
 * With no `query`: the `limit` most recent runs. Relies on `summaries` already
 * being sorted from newest to oldest — as `loadRuns` returns it — without
 * re-sorting; a caller passing a different order would get their runs in that
 * order, not by date.
 *
 * With `query`: the runs whose `label`, `notes`, `analysis` or
 * `config.criterion` carries it, case-insensitively, as a substring — never as
 * a regular expression, so that a `(` or a `*` in an agent's query never
 * crashes nor over-matches. The input order is preserved.
 *
 * `status`, in every case, filters on strict equality against `run.status`, and
 * `tag` on the exact label of one of the run's tags (case-insensitively) — the
 * tags themselves come from `tagsByRun`, not from `summaries`, and by default no
 * run carries any. */
export function searchRuns(
  summaries: RunSummary[],
  options: SearchOptions = {},
  tagsByRun: RunTags = new Map(),
): SearchHit[] {
  const limit = clampLimit(options.limit);
  return hitsOf(summaries, tagsByRun, options).slice(0, limit);
}

/** How many runs match — before `limit` cuts what is shown.
 *  Lets the caller say "you see 10 of 34", which the list bounded by
 *  `searchRuns` no longer allows once cut. */
export function countMatches(
  summaries: RunSummary[],
  options: Omit<SearchOptions, "limit"> = {},
  tagsByRun: RunTags = new Map(),
): number {
  return hitsOf(summaries, tagsByRun, options).length;
}

/** Every matching card, in input order, without applying `limit` yet: the only
 *  function that filters and scores, shared by `searchRuns` and `countMatches`
 *  so that the two never drift apart. */
function hitsOf(
  summaries: RunSummary[],
  tagsByRun: RunTags,
  options: Omit<SearchOptions, "limit">,
): SearchHit[] {
  const query = options.query?.trim();
  const tag = options.tag?.trim().toLowerCase();

  let filtered = options.status
    ? summaries.filter((summary) => summary.run.status === options.status)
    : summaries;
  if (tag) {
    filtered = filtered.filter((summary) =>
      (tagsByRun.get(summary.run.id) ?? []).some((t) => t.label.toLowerCase() === tag),
    );
  }

  if (!query) return filtered.map((summary) => cardOf(summary, tagsByRun));

  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const summary of filtered) {
    const match = matchOf(summary.run, needle);
    if (!match) continue;
    hits.push({ ...cardOf(summary, tagsByRun), matched_in: match.matched_in, snippet: match.snippet });
  }
  return hits;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function cardOf(summary: RunSummary, tagsByRun: RunTags): SearchHit {
  const { run } = summary;
  return {
    id: run.id,
    label: run.label,
    status: run.status,
    created_at: run.created_at,
    finished_at: run.finished_at,
    targets: run.config.models.targets,
    scenario_count: run.config.scenarios.length,
    total_samples: run.total_samples,
    mean: summary.mean,
    cost_usd: run.cost_usd,
    tags: (tagsByRun.get(run.id) ?? []).map((tag) => tag.label),
  };
}

/** The fields carrying `needle` (already lower-cased), and the excerpt of the
 *  first of them in `FIELDS` order — or `null` if none. */
function matchOf(
  run: EvalRun,
  needle: string,
): { matched_in: MatchedField[]; snippet: string } | null {
  const matched: MatchedField[] = [];
  let snippet = "";
  for (const { field, text } of FIELDS) {
    const value = text(run);
    if (!value.toLowerCase().includes(needle)) continue;
    matched.push(field);
    if (!snippet) snippet = snippetAround(value, needle);
  }
  return matched.length === 0 ? null : { matched_in: matched, snippet };
}

/** The text around the first occurrence of `needle` (already lower-cased) in
 *  `text`: ~80 characters before, ~120 after, runs of spaces reduced to one,
 *  and an `…` at each cut end. Never more than `SNIPPET_MAX` characters. */
function snippetAround(text: string, needle: string): string {
  const index = text.toLowerCase().indexOf(needle);
  if (index === -1) return "";

  const start = Math.max(0, index - SNIPPET_BEFORE);
  const end = Math.min(text.length, index + needle.length + SNIPPET_AFTER);
  const cutBefore = start > 0;
  const cutAfter = end < text.length;

  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (cutBefore) snippet = `…${snippet}`;
  if (cutAfter) snippet = `${snippet}…`;

  if (snippet.length > SNIPPET_MAX) {
    snippet = `${snippet.slice(0, SNIPPET_MAX - 1).trimEnd()}…`;
  }
  return snippet;
}
