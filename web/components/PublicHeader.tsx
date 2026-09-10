import { PolarisMark } from "@/components/PolarisMark";

/** The mark, on the pages that have no navigation.
 *
 * A published run and the advice documents are read by people with no session,
 * who are shown no menu — see `AppNav`. That left those pages with nothing
 * saying whose they are. This says it, and nothing else: the mark, the name, a
 * rule under them.
 *
 * Olive-deep, because the page is paper. Not a link: it would lead either
 * nowhere or to a sign-in the reader did not ask for.
 *
 * Aligned on the same column as the content it heads, which is why it carries
 * the container's width and padding rather than sitting in a band of its own. */
export function PublicHeader() {
  return (
    <div className="mx-auto w-full max-w-6xl px-8 pt-8">
      <div className="flex items-center gap-2.5 border-b border-zinc-200 pb-4 text-olive-deep">
        <PolarisMark size={24} />
        <span className="font-display text-base">Polaris Collective</span>
      </div>
    </div>
  );
}
