"use client";

/** The evaluate form, kept from one visit to the next.
 *
 * Leaving the page unmounts forty `useState` and takes everything written with
 * them. What is kept here is not a mirror of those forty: it is exactly what
 * saving a draft already sends — `config()` produces it, `fillFromConfig()`
 * reads it back. The kept form is "a draft nobody saved", and the two
 * functions that compose and restore it are the ones relaunching a run and
 * opening a draft exercise every day.
 *
 * `localStorage` rather than memory, unlike the navigation caches of
 * `store.ts`: a form that took twenty minutes to write must not die on a
 * reload. It is also what gives "Clear evaluation config" its point — with
 * memory alone, reloading would already have cleared it.
 *
 * The key carries a version, like the filter keys next door: the shape will
 * change, and reading an old one as if it were the new one would restore an
 * empty form nobody could explain.
 *
 * Every read and every write is guarded. A browser in private mode, or set to
 * refuse site storage, throws on access itself — and a form that cannot be
 * kept must still be a form that works.
 */

import type { EvalRunConfig } from "./types";

const KEY = "evals-playground:evaluate-form-v1";

/** What the form is attached to, when it is attached to anything.
 *
 * The "Evaluate" link in the bar points at a bare `/`, so coming back never
 * carries `?draft=` or `?from=`. Without this, returning from a draft would
 * silently detach the form and "Save as draft" would sow a second draft next
 * to the first. */
export type SavedAttachment =
  | { kind: "draft"; id: string; mine: boolean }
  | { kind: "relaunch"; runId: string; note: string | null };

export interface SavedForm {
  config: EvalRunConfig;
  /** Kept beside the config because `config.label` is trimmed and nulled on
   *  the way in — restoring from it would eat a space someone just typed. */
  label: string;
  csvText: string | null;
  attached: SavedAttachment | null;
  /** The columns a config file named for a CSV it did not carry. Without
   *  them, a form left mid-import forgets what the file had taken the trouble
   *  to say. */
  wantedColumns: { title: string; system: string; opening: string } | null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The attachment, or `null` when it cannot be read.
 *
 * Dropping it costs a new draft next to the old one. Dropping the form costs
 * the twenty minutes this module exists to protect — so an attachment that
 * makes no sense is thrown away on its own, never with the fields. */
function parseAttachment(raw: unknown): SavedAttachment | null {
  if (!isObject(raw)) return null;
  if (raw.kind === "draft" && typeof raw.id === "string") {
    return { kind: "draft", id: raw.id, mine: raw.mine !== false };
  }
  if (raw.kind === "relaunch" && typeof raw.runId === "string") {
    return {
      kind: "relaunch",
      runId: raw.runId,
      note: typeof raw.note === "string" ? raw.note : null,
    };
  }
  return null;
}

function parseWantedColumns(raw: unknown): SavedForm["wantedColumns"] {
  if (!isObject(raw)) return null;
  const { title, system, opening } = raw;
  if (
    typeof title !== "string" ||
    typeof system !== "string" ||
    typeof opening !== "string"
  ) {
    return null;
  }
  return { title, system, opening };
}

/** What was stored, or `null` if it is not a form.
 *
 * The config itself is only checked for being an object. It is not validated
 * field by field, on purpose: `fillFromConfig` already reads every field
 * through its own default — it has to, since a draft is allowed to hold
 * nothing but a name — and `configProblem` judges the result in the form,
 * where the message can be read and acted on. A second, stricter judgement
 * here would refuse forms the app itself considers legitimate. */
export function parseSaved(raw: unknown): SavedForm | null {
  if (!isObject(raw) || !isObject(raw.config)) return null;
  return {
    config: raw.config as unknown as EvalRunConfig,
    label: asString(raw.label),
    csvText: typeof raw.csvText === "string" ? raw.csvText : null,
    attached: parseAttachment(raw.attached),
    wantedColumns: parseWantedColumns(raw.wantedColumns),
  };
}

export function readSaved(): SavedForm | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? null : parseSaved(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Writes the form, or removes the key when it cannot.
 *
 * The removal is the point. A write that fails on quota — a large CSV — would
 * otherwise leave the previous version in place, and coming back would restore
 * a form from ten minutes ago while looking exactly like the one just left.
 * An empty form is a loss; an old form pretending to be the current one is a
 * lie, and the lie is worse. */
export function writeSaved(form: SavedForm): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(form));
  } catch {
    clearSaved();
  }
}

export function clearSaved(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing kept, nothing to clear. The form on screen is untouched.
  }
}
