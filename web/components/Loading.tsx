/** The two ways of saying "it is working", depending on whether there is
 *  already something to read or not.
 *
 * Three dots rather than a word, in both cases: there is nothing to read here,
 * only to wait. The word stays for screen readers, which do not see the
 * animation.
 */

/** Nothing to show yet: we hold the content's place.
 *
 * Laid in the flow, at the exact place the content will be written — same column,
 * same left edge. A centred message, or a block at another width, makes the page
 * jump at the moment the data arrives: one reads a thing, it moves, and one has
 * the impression everything is reloading. */
export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <p role="status" className="text-sm text-zinc-400">
      <span className="animate-pulse">•••</span>
      <span className="sr-only">{label}</span>
    </p>
  );
}

/** There is already something to read, and it is being checked again.
 *
 * Slips in beside an existing text rather than replacing it: the cache's content
 * stays readable during the check, which is the whole point of the cache. Never
 * show it at the same time as `Loading` — two indicators for the same state would
 * say the same thing twice. */
export function Refreshing({ label = "Refreshing" }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center text-xs text-teal-700">
      <span className="animate-pulse">•••</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
