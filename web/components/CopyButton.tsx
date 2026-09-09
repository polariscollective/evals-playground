"use client";

import { useState } from "react";

/** Copies a value to the clipboard, and briefly confirms it.
 *
 * `navigator.clipboard` does not exist outside a secure context — an access other
 * than localhost without HTTPS, for instance. We then fall back on a manual
 * prompt rather than failing in silence.
 *
 * `value` can be a function: a public link is built with
 * `window.location.origin`, which does not exist during server-side rendering.
 * Reading it only on click — never during render — avoids the problem without
 * any caller having to think about it.
 *
 * The content is left to the caller through `children`, which receives the
 * `copied` state: an identifier reads in plain text followed by an icon, a link
 * hides behind an icon alone, a pill may show something else entirely once
 * copied. One gesture, three different guises. */
export function CopyButton({
  value,
  title,
  className,
  children,
}: {
  value: string | (() => string);
  title: string;
  className?: string;
  children: (copied: boolean) => React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = typeof value === "function" ? value() : value;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(title, text);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? "Copied" : title}
      aria-label={title}
      className={className}
    >
      {children(copied)}
    </button>
  );
}

/** The copy icon, shared by every guise. */
export function CopyIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 3.5H3.5a1 1 0 0 0-1 1v7" />
    </svg>
  );
}

/** A minimal globe: its only role is to be recognised at a glance as "this run
 *  is public", not to represent a geography. */
export function PublicIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <ellipse cx="8" cy="8" rx="2.5" ry="6" />
      <path d="M2 8h12" />
    </svg>
  );
}

/** The "Copy" button with its word, for a document copied whole.
 *
 *  Exists mainly to be callable from a server component: `CopyButton` takes
 *  its children as a function, and a function does not cross the server →
 *  client boundary. Here the function is closed over on this side, and all
 *  that crosses is a string. */
export function CopyText({
  value,
  title,
}: {
  value: string;
  title: string;
}) {
  return (
    <CopyButton
      value={value}
      title={title}
      className="rounded border px-3 py-1 text-sm hover:bg-zinc-100"
    >
      {(copied) => (copied ? "Copied" : "Copy")}
    </CopyButton>
  );
}

/** Copie un identifiant, run ou brouillon — le geste le plus fréquent, partagé
 *  par les deux listes et la page d'un run. `title` dit lequel : le bouton se
 *  lit à la souris, et « Copy run id » sur un brouillon mentirait. */
export function CopyId({
  value,
  title = "Copy run id",
}: {
  value: string;
  title?: string;
}) {
  return (
    <CopyButton
      value={value}
      title={title}
      className="inline-flex items-center gap-1 rounded px-1 font-mono text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
    >
      {(copied) => (
        <>
          {value}
          {copied ? (
            <span className="text-teal-700">copied</span>
          ) : (
            <CopyIcon />
          )}
        </>
      )}
    </CopyButton>
  );
}
