/** The filter of the runs list and of the drafts list.
 *
 * Two kinds of filter, because there are two kinds of property.
 *
 * TAGS and STATUSES are sets: a row carries several, or none. They are turned
 * on and off one by one, and the saved state names only the ones turned off — a
 * tag created tomorrow would be born invisible if the list named the ones
 * turned on.
 *
 * DIMENSIONS are binary: a run ran locally or live, it is published or not, an
 * agent launched it or a human. Treating them as tags one turns off answered
 * only "I do not want that", never "I want ONLY that": turning "MCP" off showed
 * the human runs, but nothing showed the agent runs alone. Hence three states —
 * one side, the other, or both — and a button that cycles between them.
 *
 * The labels of both sides are reserved at creation time (see `isReservedTag`),
 * without which a real tag named "local" would be confused with the pseudo-tag
 * of the same name, and one would hide the other without anything saying so.
 *
 * The real tags, for their part, are global to the database — one row per
 * label, no user column, colour carried by the tag. Two people who write the
 * same word share the same row and the same colour.
 */

/** A run's statuses, from the most ordinary to the most alarming — and not in
 *  the type's order. A set and not a dimension: there are five of them. */
export const STATUS_TAGS = [
  "done",
  "running",
  "triggered",
  "cancelled",
  "error",
] as const;
export type StatusTag = (typeof STATUS_TAGS)[number];

/** How each status is written on screen.
 *
 * The value in the database and the displayed word differ for two of them —
 * `error` reads "failed", `triggered` reads "starting". The row's badge knew
 * that, the filter's button did not: we were filtering on "error" a status
 * displayed as "failed", and the two contradicted each other on the same
 * screen. One table only, read from both sides. */
export const STATUS_LABELS: Record<string, string> = {
  triggered: "starting",
  running: "running",
  done: "done",
  error: "failed",
  cancelled: "cancelled",
};

/** Which side of a dimension a row occupies. `a` is the notable side: the one
 *  that earns a badge on the row, and the one people come looking for. */
export type Side = "a" | "b";

/** What a dimension's button can be worth. `both` filters nothing. */
export type Choice = Side | "both";

interface Dimension {
  a: string;
  b: string;
  /** On which list this button makes sense. */
  on: "runs" | "drafts" | "both";
}

/** The dimensions, in the order the bar offers them.
 *
 * A draft has neither machine nor publication: it has not run yet, and nothing
 * is publishable as long as nothing exists. */
export const DIMENSIONS = {
  machine: { a: "local", b: "live", on: "runs" },
  visibility: { a: "public", b: "private", on: "runs" },
  author: { a: "mcp", b: "manual", on: "both" },
  kind: { a: "extend", b: "creation", on: "drafts" },
  launch: { a: "launched", b: "waiting", on: "drafts" },
} as const satisfies Record<string, Dimension>;

export type DimensionKey = keyof typeof DIMENSIONS;

export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as DimensionKey[];

/** The classes of each pseudo-label, written once.
 *
 * The badge on the row and the button in the bar read the same entry: without
 * that, the two representations of the same concept drift at the first change
 * of palette. Like `tag-colors.ts`, they are spelled out in full — Tailwind
 * builds no class at run time. The statuses take back those of the "Status"
 * column's badge. */
export const PSEUDO_TAG_CLASSES: Record<string, string> = {
  triggered: "bg-zinc-100 text-zinc-700",
  running: "bg-teal-100 text-teal-900",
  done: "bg-zinc-900 text-white",
  error: "bg-red-100 text-red-800",
  cancelled: "bg-amber-100 text-amber-900",
  local: "bg-zinc-100 text-zinc-600",
  live: "bg-zinc-100 text-zinc-600",
  public: "bg-amber-100 text-amber-800",
  private: "bg-zinc-100 text-zinc-600",
  mcp: "bg-teal-100 text-teal-900",
  manual: "bg-zinc-100 text-zinc-600",
  extend: "bg-zinc-900 text-white",
  creation: "bg-zinc-100 text-zinc-700",
  launched: "bg-zinc-200 text-zinc-700",
  waiting: "bg-zinc-100 text-zinc-700",
};

/** Everything the machine produces, and which a human therefore cannot create
 *  as a tag without a silent collision in the bar. */
const RESERVED: readonly string[] = [
  ...STATUS_TAGS,
  ...(Object.keys(DIMENSIONS) as DimensionKey[]).flatMap((key) => [
    DIMENSIONS[key].a,
    DIMENSIONS[key].b,
  ]),
];

/** Case-insensitive, like `createTag` which deduplicates through `ilike`:
 *  reserving "local" without reserving "Local" would reserve nothing. */
export function isReservedTag(label: string): boolean {
  const wanted = label.trim().toLowerCase();
  return RESERVED.some((name) => name.toLowerCase() === wanted);
}

/** What the filter reads of a run. Deliberately tiny: the logic is tested
 *  without building a whole `RunListItem`. */
export interface FilterableRun {
  status: string;
  origin: "local" | "cloud-run";
  is_public: boolean;
  launched_via: "ui" | "mcp";
}

export interface FilterableDraft {
  kind: "run" | "extend";
  launched_at: string | null;
  origin: "manual" | "mcp";
}

export type Sides = Partial<Record<DimensionKey, Side>>;

export function runSides(run: FilterableRun): Sides {
  return {
    machine: run.origin === "local" ? "a" : "b",
    visibility: run.is_public ? "a" : "b",
    author: run.launched_via === "mcp" ? "a" : "b",
  };
}

export function draftSides(draft: FilterableDraft): Sides {
  return {
    author: draft.origin === "mcp" ? "a" : "b",
    kind: draft.kind === "extend" ? "a" : "b",
    launch: draft.launched_at !== null ? "a" : "b",
  };
}

/** The word a row carries on this dimension — the one on its badge. */
export function sideLabel(key: DimensionKey, side: Side): string {
  return side === "a" ? DIMENSIONS[key].a : DIMENSIONS[key].b;
}

/** The filter's state.
 *
 * `dims` names only the dimensions NARROWED to one side: an absence means
 * "both". The default state is therefore almost empty, and a dimension added
 * tomorrow is born open rather than closed without anyone having wanted it.
 * `off` names only the tags and statuses turned off, for the same reason. */
export interface FilterState {
  dims: Sides;
  off: string[];
}

export const OPEN: FilterState = { dims: {}, off: [] };

/** Are two states the same filter?
 *
 * Compared field by field rather than by serialisation: the order of an
 * object's keys and that of an array are not guaranteed, and two identical
 * filters written in a different order would have called themselves different —
 * the link would have stayed active while promising a gesture with no effect. */
export function sameFilter(a: FilterState, b: FilterState): boolean {
  for (const key of DIMENSION_KEYS) {
    if (a.dims[key] !== b.dims[key]) return false;
  }
  if (a.off.length !== b.off.length) return false;
  const known = new Set(a.off);
  return b.off.every((label) => known.has(label));
}

/** A button's cycle: the notable side, the other, then both.
 *
 * `a` first because it is the one people come looking for — one clicks "MCP" to
 * see the agent runs, not to exclude them. */
export function nextChoice(current: Choice): Choice {
  if (current === "both") return "a";
  if (current === "a") return "b";
  return "both";
}

export function choiceOf(state: FilterState, key: DimensionKey): Choice {
  return state.dims[key] ?? "both";
}

/** Narrows a dimension to the next side, or reopens it. */
export function cycleDimension(
  state: FilterState,
  key: DimensionKey,
): FilterState {
  const next = nextChoice(choiceOf(state, key));
  const dims = { ...state.dims };
  if (next === "both") delete dims[key];
  else dims[key] = next;
  return { ...state, dims };
}

/** Turns a tag, or a status, on or off. */
export function toggleOff(state: FilterState, label: string): FilterState {
  const off = state.off.includes(label)
    ? state.off.filter((entry) => entry !== label)
    : [...state.off, label];
  return { ...state, off };
}

/** Does a row pass the filter?
 *
 * Each narrowed dimension must fall on the right side, AND none of the set
 * labels carried must be turned off. A row with no tag at all is never set
 * aside by them — it carries nothing anyone has turned off.
 *
 * A dimension the row does not know does not disqualify it: a draft has no
 * machine, and a state shared between the two lists must not erase one by the
 * other. */
export function passes(
  sides: Sides,
  labels: string[],
  state: FilterState,
): boolean {
  for (const key of DIMENSION_KEYS) {
    const wanted = state.dims[key];
    if (wanted === undefined) continue;
    const side = sides[key];
    if (side !== undefined && side !== wanted) return false;
  }
  const off = new Set(state.off);
  return !labels.some((label) => off.has(label));
}

/** Does the row answer the search?
 *
 * Insensitive to case and to accents: one types "regression" to find
 * "régression", and nobody should have to compose an accent to find their own
 * run again. NFD normalisation separates the letters from their diacritics,
 * which the `\p{Diacritic}` class then removes.
 *
 * An empty search lets everything through: that is the field's ordinary state,
 * and it must filter nothing as long as nothing has been typed.
 *
 * Searches everything that identifies a row — its name, and its identifier. The
 * identifier because that is what an agent returns and what one pastes from a
 * log; looking for it is even the most frequent case. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function matchesQuery(haystacks: (string | null)[], query: string): boolean {
  const needle = fold(query.trim());
  if (needle === "") return true;
  return haystacks.some(
    (text) => text !== null && fold(text).includes(needle),
  );
}

/** What the bar offers for the list at hand.
 *
 * A dimension is offered only if it makes sense here AND at least one row
 * occupies its notable side: offering "public / private" when nothing is
 * published would only clutter the bar. Statuses and tags: only what at least
 * one row carries.
 *
 * All of it is computed BEFORE filtering, without which narrowing a dimension
 * would make its own button disappear and there would be no way left to reopen
 * it. */
export function offered(
  mode: "runs" | "drafts",
  rows: { sides: Sides; labels: string[] }[],
): { dims: DimensionKey[]; statuses: string[]; tags: string[] } {
  const present = new Set(rows.flatMap((row) => row.labels));
  return {
    dims: DIMENSION_KEYS.filter((key) => {
      const dim = DIMENSIONS[key];
      if (dim.on !== "both" && dim.on !== mode) return false;
      return rows.some((row) => row.sides[key] === "a");
    }),
    statuses: STATUS_TAGS.filter((name) => present.has(name)),
    tags: [...present]
      .filter((label) => !RESERVED.includes(label))
      .sort((a, b) => a.localeCompare(b)),
  };
}
