"use client";

// An entity's tags — a run or a draft — and what it takes to add or remove one.
//
// Entirely controlled: the current tags and the catalogue are passed to it, as is
// the function that persists a change. The page laying this field down is alone
// in knowing which entity it is about and how to save it — that is what lets a
// forty-row list hold on a single reading of the catalogue rather than on forty.
//
// No local state imitates the tags or the catalogue: after an addition, a removal
// or a creation, `onSave` persists then `onSaved` makes the page reread — a
// removal may have emptied a tag of its last link, and the database will then
// have deleted it. This field must not go on offering it, here or on another row,
// and the only way to be sure of that is to reread.
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createTag } from "@/lib/api";
import { colorClasses } from "@/lib/tag-colors";
import type { Tag } from "@/lib/types";

export function TagField({
  tags,
  catalog,
  onSave,
  onSaved,
  compact = false,
}: {
  /** This entity's tags, as the page knows them. */
  tags: Tag[];
  /** The whole catalogue — the same list, passed to every instance on a page. */
  catalog: Tag[];
  /** Persists the list as it stands: what it held before is replaced, not added
   *  to. That is all that tells a run from a draft — `setRunTags` on one side, its
   *  draft equivalent on the other. */
  onSave: (tagIds: number[]) => Promise<unknown>;
  /** After a successful write: the page rereads the catalogue and the
   *  assignments, so that this field — and every other on the screen — reflects
   *  what the database knows, a vanished tag included. */
  onSaved: () => Promise<void>;
  /** Tightened, with the add field folded behind a button: for a list row, where
   *  one does not want a form open on every rank. A run's page keeps the field
   *  always visible. */
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const appliedIds = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  const suggestions = useMemo(
    () =>
      catalog.filter(
        (tag) => !appliedIds.has(tag.id) && tag.label.toLowerCase().includes(needle),
      ),
    [catalog, appliedIds, needle],
  );

  // Creation is safe even without knowing whether the label already exists: the
  // route returns it as it stands, without duplicating it, if it exists up to
  // case. We do not offer it when it already exists exactly as typed, so as not to
  // offer two ways of doing the same thing.
  const exactMatch = catalog.some((tag) => tag.label.toLowerCase() === needle);
  const offerCreate = trimmed !== "" && !exactMatch;

  const showInput = !compact || adding;

  const closeInput = () => {
    setOpen(false);
    if (compact) {
      setAdding(false);
      setQuery("");
    }
  };

  /** Persists `nextIds`, then rereads the catalogue and the assignments. Nothing
   *  is changed on the screen before the database confirms it — a failure
   *  therefore never leaves a pill shown, or gone, wrongly. */
  const apply = async (nextIds: number[]) => {
    setBusy(true);
    setError(null);
    try {
      await onSave(nextIds);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const addTag = (tag: Tag) => {
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
    if (appliedIds.has(tag.id)) return;
    void apply([...tags.map((t) => t.id), tag.id]);
  };

  const removeTag = (tagId: number) => {
    void apply(tags.filter((t) => t.id !== tagId).map((t) => t.id));
  };

  const createAndAdd = async () => {
    const label = trimmed;
    if (!label) return;
    setBusy(true);
    setError(null);
    let tag: Tag;
    try {
      tag = await createTag(label);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return;
    }
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
    // Safe even if the label already existed under an id other than the expected
    // one: the route returns the existing tag, and we add *that* tag. If it is
    // already laid here, the catalogue may still have changed — we reread.
    if (appliedIds.has(tag.id)) {
      setBusy(false);
      await onSaved();
      return;
    }
    await apply([...tags.map((t) => t.id), tag.id]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      closeInput();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const exact = suggestions.find((tag) => tag.label.toLowerCase() === needle);
    if (exact) addTag(exact);
    else if (suggestions.length === 1) addTag(suggestions[0]);
    else if (offerCreate) void createAndAdd();
  };

  return (
    <div
      className={
        compact
          ? "mt-1 flex flex-wrap items-center gap-1"
          : "mt-2 flex flex-wrap items-center gap-1.5"
      }
    >
      {tags.map((tag) => (
        <span
          key={tag.id}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${colorClasses(tag.color)}`}
        >
          {tag.label}
          <button
            type="button"
            onClick={() => removeTag(tag.id)}
            disabled={busy}
            aria-label={`Remove tag ${tag.label}`}
            className="leading-none hover:opacity-60 disabled:opacity-40"
          >
            ×
          </button>
        </span>
      ))}

      {!compact && tags.length === 0 && (
        <span className="text-xs text-zinc-400">No tags yet.</span>
      )}

      {showInput ? (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            disabled={busy}
            placeholder="Add a tag…"
            className="w-36 rounded border border-zinc-300 px-2 py-0.5 text-xs focus:border-zinc-500 focus:outline-none disabled:opacity-60"
          />
          {open && (suggestions.length > 0 || offerCreate) && (
            <>
              {/* A backdrop rather than a listener on `document`: it goes away with
                  the rest of the rendering, with no need to think of detaching it —
                  the same gesture as the run's actions menu. */}
              <div className="fixed inset-0 z-10" onClick={closeInput} />
              <div className="absolute left-0 z-20 mt-1 max-h-56 w-48 overflow-auto rounded border border-zinc-300 bg-white p-1 shadow-lg">
                {suggestions.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => addTag(tag)}
                    disabled={busy}
                    className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 disabled:opacity-40"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${colorClasses(tag.color)}`}
                    />
                    {tag.label}
                  </button>
                ))}
                {offerCreate && (
                  <button
                    type="button"
                    onClick={() => void createAndAdd()}
                    disabled={busy}
                    className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-zinc-100 disabled:opacity-40"
                  >
                    Create “{trimmed}”
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true);
            // Focus is only possible once the input is mounted — on the next
            // turn, not in this very render.
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          title="Add a tag"
          aria-label="Add a tag"
          className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-xs leading-none text-zinc-400 hover:border-zinc-400 hover:text-zinc-600"
        >
          +
        </button>
      )}

      {error && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
