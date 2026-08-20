"use client";

// Un menu qui s'ouvre sous son bouton.
//
// Les actions d'un run — dupliquer, compléter, relancer, exporter — sont
// nombreuses et rarement urgentes. Alignées, elles poussaient le titre du run
// hors de sa ligne et se repliaient sur deux rangs dès qu'un run avait des
// erreurs. Repliées derrière trois points, elles ne coûtent plus rien tant
// qu'on ne les cherche pas.
import { useEffect, useRef, useState, type ReactNode } from "react";

const ITEM =
  "block w-full rounded px-3 py-2 text-left text-sm hover:bg-zinc-100" +
  " disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

export function Menu({
  label = "More actions",
  children,
}: {
  label?: string;
  /** Reçoit de quoi se refermer : un menu qui reste ouvert après le clic
   *  masque le résultat de l'action qu'on vient de déclencher. */
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Échap ferme, comme partout ailleurs. Le clic ailleurs est intercepté par le
  // voile ci-dessous plutôt que par un écouteur sur `document`, qui survivrait
  // au démontage du composant s'il était mal retiré.
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
        className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm leading-5 hover:bg-zinc-50"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-64 rounded border border-zinc-300 bg-white p-1 shadow-lg"
          >
            {children(() => setOpen(false))}
          </div>
        </>
      )}
    </div>
  );
}

/** Une entrée de menu : un bouton, ou un lien quand elle mène à un fichier. */
export function MenuItem({
  onClick,
  href,
  hint,
  disabled,
  children,
}: {
  onClick?: () => void;
  href?: string;
  /** La ligne grise en dessous : ce que l'entrée fait vraiment. */
  hint?: string;
  disabled?: boolean;
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
      <a href={href} onClick={onClick} role="menuitem" className={ITEM}>
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
