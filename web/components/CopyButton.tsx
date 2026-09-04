"use client";

import { useState } from "react";

/** Copie une valeur dans le presse-papier, et le confirme brièvement.
 *
 * `navigator.clipboard` n'existe pas hors contexte sécurisé — un accès autre
 * que localhost sans HTTPS, par exemple. On retombe alors sur une invite
 * manuelle plutôt que d'échouer en silence.
 *
 * `value` peut être une fonction : un lien public se construit avec
 * `window.location.origin`, qui n'existe pas pendant le rendu côté serveur.
 * La lire seulement au clic — jamais pendant le rendu — évite le problème
 * sans qu'aucun appelant n'ait à y penser.
 *
 * Le contenu est laissé à l'appelant via `children`, qui reçoit l'état
 * `copied` : un identifiant se lit en clair suivi d'une icône, un lien se
 * cache derrière une icône seule, une pastille peut afficher tout autre
 * chose une fois copiée. Un seul geste, trois habillages différents. */
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

/** L'icône de copie, partagée par tous les habillages. */
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

/** Un globe minimal : le seul rôle est de se reconnaître au premier coup
 *  d'œil comme « ce run est public », pas de représenter une géographie. */
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
