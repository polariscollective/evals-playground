"use client";

// A menu that opens under its button.
//
// A run's actions — duplicate, complete, relaunch, export — are many and rarely
// urgent. Laid out in a row, they pushed the run's title off its line and folded
// onto two rows as soon as a run had errors. Folded behind three dots, they cost
// nothing as long as one is not looking for them.
import { useEffect, useRef, useState, type ReactNode } from "react";

const ITEM =
  "block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-100" +
  " disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

export function Menu({
  label = "More actions",
  children,
}: {
  label?: string;
  /** Receives what it needs to close itself: a menu that stays open after the
   *  click hides the result of the action just triggered. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Escape closes, as everywhere else. A click elsewhere is caught by the
  // backdrop below rather than by a listener on `document`, which would survive
  // the component's unmount if it were badly removed.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        title={label}
        className="cursor-pointer rounded-full border border-zinc-300 px-3 py-1 text-sm leading-5 hover:bg-zinc-50"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-64 rounded border border-olive bg-paper p-1"
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

/** A menu entry: a button, or a link when it leads to a file. */
export function MenuItem({
  onClick,
  href,
  hint,
  disabled,
  newTab,
  children,
}: {
  onClick?: () => void;
  href?: string;
  /** The grey line underneath: what the entry really does. */
  hint?: string;
  disabled?: boolean;
  /** Open elsewhere, for what is not a page of this application and which one
   *  does not want to cost the screen in use. */
  newTab?: boolean;
  children: ReactNode;
}) {
  const body = (
    <>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        role="menuitem"
        className={ITEM}
        {...(newTab
          ? { target: "_blank", rel: "noopener noreferrer" }
          : {})}
      >
        {body}
      </a>
    );
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      role="menuitem"
      className={`cursor-pointer ${ITEM}`}
    >
      {body}
    </button>
  );
}

export function MenuSeparator() {
  return <hr className="my-1 border-zinc-200" />;
}
