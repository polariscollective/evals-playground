"use client";

// A run's title, and the brush that renames it.
//
// The same component serves the list and a run's page: the gesture is the same,
// and two implementations would drift apart — one would know how to empty a
// title, the other not. What changes between the two is the title's guise at
// rest, hence `className` and the rendering passed as a child.
import { useEffect, useRef, useState } from "react";
import { saveRunLabel } from "@/lib/api";

export function RunTitle({
  runId,
  label,
  fallback,
  onSaved,
  className = "",
  editOnClick = false,
  inputClassName = "w-72 max-w-full border border-zinc-300 px-2 py-0.5 text-sm",
  children,
}: {
  runId: string;
  /** The saved title, or `null` when the run has none. That is what one edits —
   *  never the fallback, which one would only write in hard. */
  label: string | null;
  /** What shows for want of one: the first scenario's title, then the id. */
  fallback: string;
  /** Warn the page the title has changed, so that it rereads. */
  onSaved: (next: string | null) => void;
  className?: string;
  /** Clicking the title opens it for editing. True on a run's page, where the
   *  title is only an `<h1>`; false in the list, where it is a link to that run —
   *  a click there must navigate, and stealing that gesture would make the list
   *  unusable. */
  editOnClick?: boolean;
  /** How the field presents itself. By default a small list field; on a run's
   *  page it is given the title's own look — serif, twice as large, full width —
   *  so that nothing jumps at the moment it opens. */
  inputClassName?: string;
  /** The title at rest, rendered by the caller: a link in the list, an `<h1>` on
   *  the run's page. */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // The cursor goes into the field on opening: without that, it takes a second
  // click to write what one has just asked to write.
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const open = () => {
    // The draft starts from the saved title, not from the fallback: taking up the
    // first scenario's title would write it in hard on the first save, and the run
    // would stop following its scenario if that were renamed.
    setDraft(label ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const { label: saved } = await saveRunLabel(runId, draft);
      onSaved(saved);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
        {editOnClick ? (
          <span
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
            title="Rename this run"
            className="cursor-text"
          >
            {children}
          </span>
        ) : (
          children
        )}
        <button
          type="button"
          onClick={open}
          aria-label="Rename this run"
          title="Rename this run"
          className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-700"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex w-full flex-wrap items-center gap-1.5">
      <input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves, Escape gives up: the two reflexes of a field that opens
          // in place. Without them, one has to aim at a button to get out of a
          // gesture one opened with a click.
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
        disabled={busy}
        placeholder={fallback}
        aria-label="Run title"
        className={inputClassName}
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={busy}
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40"
      >
        Cancel
      </button>
      {/* Emptying the field does not erase the run: it takes its name away, and
          the fallback takes over. Saying so, because an empty field in front of a
          "Save" button does not inspire confidence. */}
      <span className="text-xs text-zinc-500">
        {draft.trim() === "" ? `Empty — will show “${fallback}”` : ""}
      </span>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
