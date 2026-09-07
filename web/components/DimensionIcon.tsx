// Une icône par dimension, la même des deux côtés.
//
// Le mot change — « local » ou « live », « MCP » ou « manual » — mais l'icône
// reste : c'est elle qui dit de quelle question il s'agit, et le mot lequel
// des deux côtés on regarde. Sans elle, un bouton qui passe de « public » à
// « private » ressemble à un autre bouton apparu au même endroit.
//
// Dessinées ici plutôt que chargées : un `<img>` ne suit pas `currentColor`,
// et ces icônes vivent dans des pastilles de six couleurs différentes.
import type { DimensionKey } from "@/lib/run-filters";

const PATHS: Record<DimensionKey, React.ReactNode> = {
  // Un écran sur son pied : la machine où le job a tourné.
  machine: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M6 13.5h4M8 11v2.5" />
    </>
  ),
  // Un globe : ce que le monde peut lire.
  visibility: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
    </>
  ),
  // Une étincelle : qui a appuyé — une machine, ou une main.
  author: (
    <path d="M8 2.5 9.3 6.7 13.5 8 9.3 9.3 8 13.5 6.7 9.3 2.5 8 6.7 6.7Z" />
  ),
  // Un carré qu'on agrandit : ajouter à un run, ou en créer un.
  kind: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
      <path d="M12 8.5v5M9.5 11h5" />
    </>
  ),
  // Un drapeau : parti, ou encore en attente.
  launch: (
    <>
      <path d="M4 14V2.5" />
      <path d="M4 3h8l-2 2.75L12 8.5H4Z" />
    </>
  ),
};

export function DimensionIcon({ dimension }: { dimension: DimensionKey }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[dimension]}
    </svg>
  );
}
