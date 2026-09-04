// Chercher un run parmi ceux déjà chargés — aucune requête neuve.
//
// `search_runs` (le connecteur MCP) répond à « as-tu déjà vu un run qui
// parlait de ça ? ». Le filtrage se fait ici, en TypeScript, sur ce que
// `loadRuns` a déjà ramené : le mot-clé de l'agent ne touche jamais une
// expression de filtre PostgREST, et cette fonction reste pure — donc l'une
// des rares parties du connecteur que `node --test` couvre vraiment. Pas de
// `server-only` ici : `route.ts` charge les runs, cette fonction ne fait que
// les trier et les découper.
import type { EvalRun, RunStatus, RunSummary, Tag } from "./types";

/** Une fiche courte — jamais les notes entières ni la matrice. L'agent
 *  rappelle `get_run_metadata` ou `get_run_results` sur ce qu'il retient. */
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
  /** Les libellés des tags du run, dans l'ordre où `tagsByRun` les porte —
   *  jamais la couleur : un agent ne peint rien. Vide si le run n'en a pas. */
  tags: string[];
  /** Seulement si une requête a été donnée : les champs qui la portent. */
  matched_in?: MatchedField[];
  /** Seulement si une requête a été donnée : le texte autour de la première
   *  occurrence, dans le premier champ de `FIELDS` qui correspond. */
  snippet?: string;
}

export interface SearchOptions {
  query?: string;
  limit?: number;
  status?: string;
  /** Ne garder que les runs qui portent ce libellé de tag, sans casse, en
   *  égalité exacte — jamais en sous-chaîne : `api` ne doit pas remonter un
   *  tag `rapide`. */
  tag?: string;
}

/** Les tags d'un run, par identifiant de run — la forme que rend
 *  `tagsByRun()` (`lib/tags.ts`). Passée en argument plutôt qu'importée : ce
 *  module reste pur, chargeable par `node --test`, et `lib/tags.ts` est
 *  `server-only`. */
export type RunTags = Map<string, Tag[]>;

type MatchedField = "label" | "notes" | "analysis" | "criterion";

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/** Où chercher, et dans quel ordre : c'est aussi l'ordre de priorité du
 *  snippet — le premier champ qui correspond fournit l'extrait. */
const FIELDS: { field: MatchedField; text: (run: EvalRun) => string }[] = [
  { field: "label", text: (run) => run.label ?? "" },
  { field: "criterion", text: (run) => run.config.criterion ?? "" },
  { field: "notes", text: (run) => run.notes ?? "" },
  { field: "analysis", text: (run) => run.analysis ?? "" },
];

const SNIPPET_BEFORE = 80;
const SNIPPET_AFTER = 120;
const SNIPPET_MAX = 250;

/** Les runs récents, ou ceux dont le texte porte `query`.
 *
 * Sans `query` : les `limit` runs les plus récents. Compte sur `summaries`
 * déjà trié du plus récent au plus ancien — comme le rend `loadRuns` — sans
 * le retrier ; un appelant qui passerait un ordre différent obtiendrait ses
 * runs dans cet ordre-là, pas par date.
 *
 * Avec `query` : les runs dont `label`, `notes`, `analysis` ou
 * `config.criterion` la porte, insensible à la casse, en sous-chaîne — jamais
 * en expression régulière, pour qu'un `(` ou un `*` dans la requête d'un
 * agent ne fasse jamais planter ni sur-matcher. L'ordre d'entrée est
 * préservé.
 *
 * `status`, dans tous les cas, filtre en égalité stricte sur `run.status`, et
 * `tag` sur le libellé exact d'un tag du run (sans casse) — les tags eux-mêmes
 * viennent de `tagsByRun`, pas de `summaries`, et par défaut aucun run n'en
 * porte. */
export function searchRuns(
  summaries: RunSummary[],
  options: SearchOptions = {},
  tagsByRun: RunTags = new Map(),
): SearchHit[] {
  const limit = clampLimit(options.limit);
  return hitsOf(summaries, tagsByRun, options).slice(0, limit);
}

/** Combien de runs correspondent — avant que `limit` n'en coupe l'affichage.
 *  Sert à l'appelant à dire « tu vois 10 sur 34 », ce que la liste bornée par
 *  `searchRuns` ne permet plus de savoir une fois coupée. */
export function countMatches(
  summaries: RunSummary[],
  options: Omit<SearchOptions, "limit"> = {},
  tagsByRun: RunTags = new Map(),
): number {
  return hitsOf(summaries, tagsByRun, options).length;
}

/** Toutes les fiches qui correspondent, dans l'ordre d'entrée, sans encore
 *  appliquer `limit` : la seule fonction qui filtre et note, partagée par
 *  `searchRuns` et `countMatches` pour qu'elles ne divergent jamais. */
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

/** Les champs qui portent `needle` (déjà en minuscules), et l'extrait du
 *  premier d'entre eux dans l'ordre de `FIELDS` — ou `null` si aucun. */
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

/** Le texte autour de la première occurrence de `needle` (déjà en
 *  minuscules) dans `text` : ~80 caractères avant, ~120 après, les suites
 *  d'espaces réduites à une seule, et un `…` à chaque bout coupé. Jamais plus
 *  de `SNIPPET_MAX` caractères. */
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
