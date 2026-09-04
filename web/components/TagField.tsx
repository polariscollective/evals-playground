"use client";

// Les tags d'un run : ses pastilles, et un champ pour en ajouter ou en retirer.
//
// Autonome — il charge lui-même la liste des tags et celle du run au montage.
// La page qui le pose n'a rien à lui passer d'autre que l'identifiant du run.
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { createTag, getRunTags, getTags, setRunTags } from "@/lib/api";
import { colorClasses } from "@/lib/tag-colors";
import type { Tag } from "@/lib/types";

export function TagField({ runId }: { runId: string }) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [runTags, setRunTagsState] = useState<Tag[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([getTags(), getRunTags(runId)])
      .then(([tags, current]) => {
        setAllTags(tags);
        setRunTagsState(current);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoaded(true));
  }, [runId]);

  const appliedIds = useMemo(() => new Set(runTags.map((t) => t.id)), [runTags]);
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  const suggestions = useMemo(
    () =>
      allTags.filter(
        (tag) => !appliedIds.has(tag.id) && tag.label.toLowerCase().includes(needle),
      ),
    [allTags, appliedIds, needle],
  );

  // La création est sûre même sans savoir si le libellé existe déjà : la
  // route le rend tel quel, sans le dupliquer, si la casse près il existe.
  // On ne la propose pas quand il existe déjà tel quel, pour ne pas offrir
  // deux façons de faire la même chose.
  const exactMatch = allTags.some((tag) => tag.label.toLowerCase() === needle);
  const offerCreate = trimmed !== "" && !exactMatch;

  /** Pose `next` en local tout de suite, et le confirme en base. Un échec
   *  revient sur `previous` — jamais de pastille qui reste affichée, ou
   *  disparue, alors que la base dit autre chose. */
  const apply = async (next: Tag[], previous: Tag[]) => {
    setRunTagsState(next);
    setBusy(true);
    setError(null);
    try {
      await setRunTags(runId, next.map((tag) => tag.id));
    } catch (e) {
      setRunTagsState(previous);
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
    void apply([...runTags, tag], runTags);
  };

  const removeTag = (tagId: number) => {
    void apply(
      runTags.filter((tag) => tag.id !== tagId),
      runTags,
    );
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
    setAllTags((current) =>
      current.some((t) => t.id === tag.id)
        ? current
        : [...current, tag].sort((a, b) => a.label.localeCompare(b.label)),
    );
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
    setBusy(false);
    // Sûr même si le libellé existait déjà sous un autre id que celui
    // attendu : la route rend l'existant, et on ajoute *ce* tag-là.
    if (!runTags.some((t) => t.id === tag.id)) {
      await apply([...runTags, tag], runTags);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
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
    <section className="rounded border border-zinc-300 p-3">
      <h2 className="text-sm font-medium">Tags</h2>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {runTags.map((tag) => (
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

        {loaded && runTags.length === 0 && (
          <span className="text-xs text-zinc-400">No tags yet.</span>
        )}

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
              {/* Un voile plutôt qu'un écouteur sur `document` : il se retire
                  avec le reste du rendu, sans qu'il faille penser à le
                  détacher — même geste que le menu des actions du run. */}
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
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
      </div>

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
