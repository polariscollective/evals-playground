"use client";

// A one-line explanation, folded away behind an information dot.
//
// For what has to be known once and clutters afterwards: a run's shape reads
// "scenarios × models × repetitions", and repeating it under each of the
// thirteen rows cost a column twice too wide for three figures.
//
// A separate component rather than `Menu`: that one imposes its "⋯" glyph and a
// `role="menu"`, which announces a list of actions. Here there is nothing to
// choose, only to read.
import { useEffect, useState } from "react";

export function InfoDot({
  label,
  glyph = "ⓘ",
  tone = "text-zinc-400 hover:text-zinc-700",
  children,
}: {
  label: string;
  /** The button's character. "ⓘ" for a piece of help, "⚠" for a blocker: they
   *  are not the same invitation, and the same dot would confuse them. */
  glyph?: string;
  tone?: string;
  children: string;
}) {
  const [open, setOpen] = useState(false);

  // Escape closes, like the actions menu. A click elsewhere is caught by the
  // backdrop below rather than by a listener on `document`, which would survive
  // the unmount if it were badly removed.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className={`cursor-pointer align-middle ${tone}`}
      >
        {glyph}
      </button>
      {open && (
        <>
          <span
            className="fixed inset-0 z-10 block"
            onClick={() => setOpen(false)}
          />
            {/* `normal-case` and `tracking-normal`: the table's header is in
                spaced small capitals, and a sentence would inherit them. */}
          <span
            role="note"
            className="absolute left-0 top-full z-20 mt-1 block w-max max-w-xs rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-normal normal-case tracking-normal text-zinc-700 shadow-lg"
          >
            {children}
          </span>
        </>
      )}
    </span>
  );
}
