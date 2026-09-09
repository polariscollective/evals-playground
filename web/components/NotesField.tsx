"use client";

import { useState } from "react";
import { Collapsible } from "@/components/Collapsible";
import { renderMarkdown } from "@/lib/markdown";

/** A run's comment: markdown while editing, HTML once saved.
 *
 * The same component serves before the launch and on the run's page. Without
 * `onSave`, saving only switches to reading — that is the form's case, where the
 * note leaves with the run's configuration.
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
  /** The editing area's height. Larger on a run's page, where one writes one's
      conclusions, than on the form, where one notes an intention. */
  rows?: number;
  /** The heading shown. The component also serves a run's analysis — same
   *  markdown reading, same editing gesture, only the heading tells the preamble
   *  from the analysis written afterwards. */
  label?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** What the user decided, or `null` if they decided nothing.
   *
   * Derived rather than synchronised: as long as nobody has touched the field,
   * its mode follows what it holds — empty, we open in editing, because an empty
   * block with an "Edit" button would ask for a click for nothing; filled, we
   * show the rendered markdown.
   *
   * That is what was missing: the mode was decided on mount alone, where the
   * field is empty on the form. A note arriving afterwards — a draft opened, a
   * configuration pasted, a run taken up again — therefore stayed in editing, and
   * one had to click "Save" to see one's own markdown.
   *
   * As soon as one writes or clicks "Edit", the decision is taken and nothing
   * closes the field under one's fingers any more. */
  const [chosen, setChosen] = useState<boolean | null>(null);
  const editing = chosen ?? value.trim() === "";

  const save = async () => {
    setSaving(true);
    try {
      if (onSave) await onSave(value);
      setError(null);
      setChosen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    // Foldable by its heading, except while editing: `pinned` holds it open, and
    // "Edit" on a folded box reopens it in the same gesture, since it turns
    // `editing` true.
    <Collapsible
      className="rounded border border-zinc-300 p-3"
      pinned={editing}
      title={<h2 className="text-sm font-medium">{label}</h2>}
      aside={
        editing ? (
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
            onClick={() => setChosen(true)}
            className="rounded border border-zinc-300 px-2 py-0.5 text-xs"
          >
            Edit
          </button>
        )
      }
    >
      {editing ? (
        <>
          <textarea
            value={value}
            onChange={(e) => {
              // Writing counts as a decision: without that, emptying the field
              // would close it at the last character.
              setChosen(true);
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
          // Safe: `renderMarkdown` escapes all the input HTML before producing
          // the only tags it builds itself.
          dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
        />
      )}

      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </Collapsible>
  );
}
