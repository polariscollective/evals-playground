// A judge's name and its handle.
//
// Two strings that do different jobs and must not be confused.
//
// The **label** is what a person reads. It is unique across the whole database,
// because MCP resolves a judge by handle and a name that is ambiguous between
// two accounts would be a silent mistake, never a visible one. It can be
// changed at any time, on a judge that has graded a hundred conversations
// included: a name has never graded anything, so renaming rewrites no result.
//
// The **slug** is the handle: what MCP and a URL use to name this judge. It is
// derived from the label when the judge is created and never moves afterwards.
// Renaming must not break the links that name the judge, and a handle that
// follows the name is a handle that stops working the day somebody improves a
// name.
//
// Both are generated here rather than in the database, apart from the one-off
// backfill of the rows that existed before them (see the migration
// `20260910090000_judges_become_a_library.sql`, polaris-supabase repository).
// That backfill does not have to produce the same strings this file would: it
// only had to produce valid unique ones on names it was guessing.
import type { JudgeSystemTypeColumn } from "./types";

/** The longest a generated label runs before it is cut.
 *
 * Long enough to tell two criteria apart that open the same way, short enough
 * to sit in a table cell. A criterion is a paragraph; a name is not. */
const LABEL_LIMIT = 70;

/** The longest a slug runs. Shorter than the label, because it goes in URLs. */
const SLUG_LIMIT = 60;

/** Accented letters folded to their unaccented form.
 *
 * Written out rather than reached for through `String.normalize("NFD")` plus a
 * combining-marks range: the explicit map is what the migration's `translate()`
 * does on the SQL side, and having the two agree on sight is worth more here
 * than being clever. */
const FOLD: Record<string, string> = {
  à: "a", â: "a", ä: "a", á: "a", ã: "a", å: "a",
  ç: "c",
  è: "e", ê: "e", ë: "e", é: "e",
  ì: "i", î: "i", ï: "i", í: "i",
  ò: "o", ô: "o", ö: "o", ó: "o", õ: "o",
  ù: "u", û: "u", ü: "u", ú: "u",
  ý: "y", ÿ: "y",
  ñ: "n",
};

/** A label turned into a handle: lowercase, accents folded, everything else a
 *  hyphen.
 *
 * The hyphens are trimmed AFTER the cut, never before. Cutting at sixty
 * characters lands in the middle of a word about half the time and leaves a
 * trailing hyphen, which `judges_slug_shape_check` refuses. The migration made
 * exactly that mistake and the local replay caught it.
 *
 * Empty in, `"judge"` out: a label made only of punctuation would otherwise
 * produce an empty handle, and the column is `NOT NULL`. */
export function slugify(label: string): string {
  const folded = [...label.toLowerCase()]
    .map((character) => FOLD[character] ?? character)
    .join("");
  const hyphenated = folded.replace(/[^a-z0-9]+/g, "-");
  const cut = hyphenated.slice(0, SLUG_LIMIT);
  const trimmed = cut.replace(/^-+/, "").replace(/-+$/, "");
  return trimmed || "judge";
}

/** The name a judge gets when nobody wrote one.
 *
 * Derived from the criterion, because that is the only thing on the form that
 * describes what this judge is for. A system judge has no criterion in the
 * database at all, so its name comes from its type.
 *
 * Naming is better done by hand, and the format invites it. This exists so that
 * a configuration written before labels existed, or by an agent that did not
 * name its judges, still lands with something readable rather than a UUID. */
export function labelFrom(
  criterion: string | null | undefined,
  systemType: JudgeSystemTypeColumn,
): string {
  if (systemType === "awake") return "Eval awareness";
  if (systemType === "faithful_adversary") return "Adversary fidelity";
  const flattened = (criterion ?? "").replace(/\s+/g, " ").trim();
  if (!flattened) return "Untitled judge";
  return flattened.slice(0, LABEL_LIMIT).trim();
}

/** The same name, made free.
 *
 * `taken` is what the database already holds. The caller reads it; this
 * function stays pure so it can be tested without one.
 *
 * Numbered rather than given a random suffix, because these names are read.
 * "Eval awareness (2)" says what happened; "eval-awareness-x7fq" does not, and
 * the day somebody sees it they cannot tell a collision from a mangling.
 *
 * The bare name goes to whoever asks first. That matters on the backfill and it
 * matters here: the judge that has been around longest keeps the clean name. */
export function freeName(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(desired)) return desired;
  for (let n = 2; ; n += 1) {
    const candidate = `${desired} (${n})`;
    if (!used.has(candidate)) return candidate;
  }
}

/** The same, for a handle: hyphen and a number rather than a parenthesis. */
export function freeSlug(desired: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(desired)) return desired;
  for (let n = 2; ; n += 1) {
    const candidate = `${desired}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** What the database already holds, for `freeName` and `freeSlug`. Loaded once
 *  per launch rather than per judge: a run creates several at a time, and they
 *  have to avoid one another as well as what is already there. */
export interface TakenNames {
  labels: Set<string>;
  slugs: Set<string>;
}

/** A label and a handle for one judge, avoiding everything already taken AND
 *  everything handed out earlier in the same call.
 *
 * Mutates `taken`, deliberately: launching a run with two judges that share a
 * criterion must not name them both the same thing, and the only way to get
 * that right is for each name handed out to be taken from the next one's point
 * of view. */
export function nameJudge(
  wanted: string | null | undefined,
  criterion: string | null | undefined,
  systemType: JudgeSystemTypeColumn,
  taken: TakenNames,
): { label: string; slug: string } {
  const wantedLabel = (wanted ?? "").replace(/\s+/g, " ").trim();
  const label = freeName(
    wantedLabel ? wantedLabel.slice(0, LABEL_LIMIT) : labelFrom(criterion, systemType),
    taken.labels,
  );
  const slug = freeSlug(slugify(label), taken.slugs);
  taken.labels.add(label);
  taken.slugs.add(slug);
  return { label, slug };
}
