"use client";

// Une explication d'une ligne, repliée derrière un point d'information.
//
// Pour ce qu'il faut savoir une fois et qui encombre ensuite : la forme d'un
// run se lit « scénarios × modèles × répétitions », et le répéter sous chacune
// des treize lignes coûtait une colonne deux fois trop large pour trois
// chiffres.
//
// Un composant à part plutôt que `Menu` : celui-là impose son glyphe « ⋯ » et
// un `role="menu"`, qui annonce une liste d'actions. Ici il n'y a rien à
// choisir, seulement à lire.
import { useEffect, useState } from "react";

export function InfoDot({
  label,
  glyph = "ⓘ",
  tone = "text-zinc-400 hover:text-zinc-700",
  children,
}: {
  label: string;
  /** Le caractère du bouton. « ⓘ » pour une aide, « ⚠ » pour un blocage : ce
   *  n'est pas la même invitation, et le même point les confondrait. */
  glyph?: string;
  tone?: string;
  children: string;
}) {
  const [open, setOpen] = useState(false);

  // Échap ferme, comme le menu des actions. Le clic ailleurs est intercepté
  // par le voile ci-dessous plutôt que par un écouteur sur `document`, qui
  // survivrait au démontage s'il était mal retiré.
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
          {/* `normal-case` et `tracking-normal` : l'en-tête du tableau est en
              petites capitales espacées, et une phrase en hériterait. */}
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
