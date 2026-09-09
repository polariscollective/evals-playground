// One icon per dimension, the same on both sides.
//
// The word changes — "local" or "live", "MCP" or "manual" — but the icon stays:
// it is what says which question is at stake, and the word which of the two
// sides one is looking at. Without it, a button going from "public" to "private"
// looks like another button appearing in the same place.
//
// Drawn here rather than loaded: an `<img>` does not follow `currentColor`, and
// these icons live inside pills of six different colours.
import type { DimensionKey } from "@/lib/run-filters";

const PATHS: Record<DimensionKey, React.ReactNode> = {
  // A screen on its stand: the machine the job ran on.
  machine: (
    <>
      <rect x="2" y="3" width="12" height="8" rx="1" />
      <path d="M6 13.5h4M8 11v2.5" />
    </>
  ),
  // A globe: what the world can read.
  visibility: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
    </>
  ),
  // A spark: who pressed — a machine, or a hand.
  author: (
    <path d="M8 2.5 9.3 6.7 13.5 8 9.3 9.3 8 13.5 6.7 9.3 2.5 8 6.7 6.7Z" />
  ),
  // A square being enlarged: adding to a run, or creating one.
  kind: (
    <>
      <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
      <path d="M12 8.5v5M9.5 11h5" />
    </>
  ),
  // A flag: gone, or still waiting.
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
