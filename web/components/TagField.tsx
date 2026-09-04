"use client";

// Les tags d'une entité — un run ou un brouillon — et de quoi en ajouter ou
// en retirer.
//
// Entièrement contrôlé : les tags courants et le catalogue lui sont passés,
// tout comme la fonction qui persiste un changement. La page qui pose ce
// champ est seule à savoir de quelle entité il s'agit et comment
// l'enregistrer — c'est ce qui permet à une liste de quarante lignes de
// tenir sur une seule lecture du catalogue plutôt que sur quarante.
//
// Aucun état local n'imite les tags ou le catalogue : après un ajout, un
// retrait ou une création, `onSave` persiste puis `onSaved` fait relire la
// page — un retrait a pu vider un tag de son dernier lien, et la base l'aura
// alors supprimé. Ce champ ne doit pas continuer à le proposer, ici ou sur
// une autre ligne, et la seule façon d'en être sûr est de relire.
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
  /** Les tags de cette entité, tels que la page les connaît. */
  tags: Tag[];
  /** Le catalogue entier — la même liste, passée à chaque instance d'une page. */
  catalog: Tag[];
  /** Persiste la liste telle quelle : ce qu'elle contenait avant est
   *  remplacé, pas complété. C'est tout ce qui distingue un run d'un
   *  brouillon — `setRunTags` d'un côté, son équivalent brouillon de l'autre. */
  onSave: (tagIds: number[]) => Promise<unknown>;
  /** Après une écriture réussie : la page relit le catalogue et les
   *  affectations, pour que ce champ — et tout autre à l'écran — reflète ce
   *  que la base sait, y compris un tag disparu. */
  onSaved: () => Promise<void>;
  /** Resserré, avec le champ d'ajout replié derrière un bouton : pour une
   *  ligne de liste, où l'on ne veut pas d'un formulaire ouvert sur chaque
   *  rangée. La page d'un run garde le champ toujours visible. */
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

  // La création est sûre même sans savoir si le libellé existe déjà : la
  // route le rend tel quel, sans le dupliquer, si la casse près il existe.
  // On ne la propose pas quand il existe déjà tel quel, pour ne pas offrir
  // deux façons de faire la même chose.
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

  /** Persiste `nextIds`, puis relit le catalogue et les affectations. Rien
   *  n'est changé à l'écran avant que la base ne le confirme — un échec ne
   *  laisse donc jamais une pastille affichée, ou disparue, à tort. */
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
    // Sûr même si le libellé existait déjà sous un autre id que celui
    // attendu : la route rend l'existant, et on ajoute *ce* tag-là. S'il est
    // déjà posé ici, le catalogue a tout de même pu changer — on relit.
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
              {/* Un voile plutôt qu'un écouteur sur `document` : il se retire
                  avec le reste du rendu, sans qu'il faille penser à le
                  détacher — même geste que le menu des actions du run. */}
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
            // Le focus n'est possible qu'une fois l'input monté — au tour
            // suivant, pas dans ce même rendu.
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
