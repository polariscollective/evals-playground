import { POLARIS_SITE, PolarisMark } from "@/components/PolarisMark";

/** The band the pages with no navigation carry, and what sits on the right of it.
 *
 * A published run and the advice documents are read by people with no session,
 * who are shown no menu — see `AppNav`. That left those pages with nothing
 * saying whose they are. This says it: the mark, the name, a rule underneath.
 *
 * What each page hands as `children` goes to the right of the band: the line
 * saying the copy is read only, and the way back into the application. They
 * were stacked above the title before, where they pushed the run's name down
 * the page and left the band half empty.
 *
 * Sticky, and opaque, so that the way back stays reachable from the bottom of a
 * long run rather than only from the top of it.
 *
 * The mark is olive-deep, because the page is paper, and it leads to the
 * collective's site. Not into this application: a reader with no session would
 * be sent to a sign-in they did not ask for, and the way in is the button on the
 * right of this same band.
 *
 * Aligned on the same column as the content it heads, which is why it carries
 * the container's width and padding rather than sitting in a band of its own. */
export function PublicHeader({ children }: { children?: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-40 bg-paper">
      <div className="mx-auto w-full max-w-6xl px-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-200 py-4 text-olive-deep">
          {/* Olive under the cursor rather than chartreuse: chartreuse on paper
              is 1.59:1, and a mark that fades on hover reads as broken. */}
          <a
            href={POLARIS_SITE}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 transition-colors duration-150 hover:text-olive"
          >
            <PolarisMark size={24} />
            <span className="font-display text-base">Polaris Collective</span>
          </a>
          {children && (
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
