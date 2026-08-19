"use client";

import { useState } from "react";
import { renderMarkdown } from "@/lib/markdown";

/** Le commentaire d'un run : markdown en édition, HTML une fois sauvé.
 *
 * Le même composant sert avant le lancement et sur la page du run. Sans
 * `onSave`, sauver ne fait que basculer en lecture — c'est le cas du
 * formulaire, où la note part avec la configuration du run.
 */
export function NotesField({
  value,
  onChange,
  onSave,
  hint = "What are you testing, what did you notice?",
}: {
  value: string;
  onChange: (next: string) => void;
  onSave?: (next: string) => Promise<void>;
  hint?: string;
}) {
  // On ouvre en édition quand il n'y a rien à lire : afficher un bloc vide
  // avec un bouton « Edit » demanderait un clic pour rien.
  const [editing, setEditing] = useState(value.trim() === "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    try {
      if (onSave) await onSave(value);
      setError(null);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded border border-zinc-300 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Notes</h2>
        {editing ? (
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            placeholder={hint}
            className="mt-2 w-full rounded border border-zinc-300 p-2 font-mono text-sm"
          />
          <p className="text-xs text-zinc-500">
            Markdown — rendered when you save.
          </p>
        </>
      ) : (
        <div
          className="notes-prose mt-2 text-sm"
          // Sûr : `renderMarkdown` échappe tout le HTML d'entrée avant de
          // produire les seules balises qu'il fabrique lui-même.
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
        />
      )}

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
