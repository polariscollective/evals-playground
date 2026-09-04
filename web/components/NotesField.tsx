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
  rows = 4,
  label = "Notes",
}: {
  value: string;
  onChange: (next: string) => void;
  onSave?: (next: string) => Promise<void>;
  hint?: string;
  /** Hauteur de la zone d'édition. Plus grande sur la page d'un run, où l'on
      écrit ses conclusions, que sur le formulaire, où l'on note une intention. */
  rows?: number;
  /** Le titre affiché. Le composant sert aussi à l'analyse d'un run — même
   *  lecture markdown, même geste d'édition, seul le titre distingue le
   *  préambule de l'analyse écrite après coup. */
  label?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Ce que l'utilisateur a décidé, ou `null` s'il n'a rien décidé.
   *
   * Dérivé plutôt que synchronisé : tant que personne n'a touché au champ, son
   * mode suit ce qu'il contient — vide, on ouvre en édition, parce qu'un bloc
   * vide avec un bouton « Edit » demanderait un clic pour rien ; rempli, on
   * affiche le markdown rendu.
   *
   * C'est ce qui manquait : le mode se décidait au seul montage, où le champ
   * est vide sur le formulaire. Une note qui arrive après — un brouillon
   * ouvert, une configuration collée, un run repris — restait donc en édition,
   * et il fallait cliquer sur « Save » pour voir son propre markdown.
   *
   * Dès qu'on écrit ou qu'on clique sur « Edit », la décision est prise et
   * plus rien ne referme le champ sous les doigts. */
  const [choisi, setChoisi] = useState<boolean | null>(null);
  const editing = choisi ?? value.trim() === "";

  const save = async () => {
    setSaving(true);
    try {
      if (onSave) await onSave(value);
      setError(null);
      setChoisi(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded border border-zinc-300 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{label}</h2>
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
            onClick={() => setChoisi(true)}
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
            onChange={(e) => {
              // Écrire vaut décision : sans ça, vider le champ le refermerait
              // au caractère près.
              setChoisi(true);
              onChange(e.target.value);
            }}
            rows={rows}
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
