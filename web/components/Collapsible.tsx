"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/** Une case qu'on replie en cliquant son titre.
 *
 * Ouverte au départ : ce qu'on vient lire est là sans un geste, et replier
 * n'est utile qu'une fois qu'on a lu. Seul le titre bascule, pas l'en-tête
 * entier — plusieurs de ces cases y portent un bouton (« Edit », « Save »),
 * qu'un en-tête cliquable en entier avalerait.
 *
 * Ce qui est replié n'est pas rendu du tout : les cases repliables d'ici
 * portent des tableaux et des transcriptions, et les garder montées pour la
 * seule beauté d'une animation ferait payer une lecture qu'on a rangée.
 */
export function Collapsible({
  title,
  aside,
  className,
  bodyClassName,
  pinned = false,
  children,
}: {
  /** Le titre avec ses propres classes — `eyebrow` sur les cases de lecture,
   *  `text-sm font-medium` sur les champs : chaque case garde la sienne. */
  title: ReactNode;
  /** Ce qui se tient à droite du titre. Reste visible une fois repliée :
   *  « judged by claude-x », « Edit », se lisent justement quand le reste
   *  est rangé — et « Edit » rouvre la case en y entrant. */
  aside?: ReactNode;
  className?: string;
  /** L'espacement entre les enfants, celui que portait la case avant qu'ils
   *  passent dans un bloc à eux, pour que rien ne bouge une fois ouverte. */
  bodyClassName?: string;
  /** Ouverte de force, sans chevron ni bascule. C'est ce dont un champ en
   *  cours d'édition a besoin : replier ce qu'on est en train d'écrire
   *  ferait disparaître la frappe sous les doigts. */
  pinned?: boolean;
  children: ReactNode;
}) {
  const [replié, setReplié] = useState(false);
  const ouvert = pinned || !replié;

  return (
    <section className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {pinned ? (
          title
        ) : (
          <button
            type="button"
            onClick={() => setReplié((plié) => !plié)}
            aria-expanded={ouvert}
            className="group flex cursor-pointer items-baseline gap-1.5 text-left"
          >
            <svg
              viewBox="0 0 10 10"
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 text-zinc-400 transition-transform group-hover:text-zinc-700 ${
                ouvert ? "" : "-rotate-90"
              }`}
            >
              <path
                d="M1.5 3.5 L5 7 L8.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {title}
          </button>
        )}
        {aside}
      </div>
      {ouvert && <div className={bodyClassName}>{children}</div>}
    </section>
  );
}
