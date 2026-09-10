"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { getMe } from "@/lib/api";
import { logout } from "@/lib/auth-actions";
import { isOpen } from "@/lib/public-paths";
import { ensureRunsLoaded } from "@/lib/runs-store";
import { ensureTagsLoaded } from "@/lib/tags-store";
import { ensureProfileLoaded } from "@/lib/profile-store";
import { ensureConnectionsLoaded } from "@/lib/connections-store";
import { ensureJudgesLoaded } from "@/lib/judges-store";
import { POLARIS_SITE, PolarisMark } from "@/components/PolarisMark";

/** The private application's navigation, absent from `/shared`.
 *
 * "Publishing opens a run, not the application" — a stranger arriving on a
 * published run must not see a menu towards pages that demand a session, nor
 * under what address somebody else is signed in.
 *
 * A client component rather than a route group: the second would have moved
 * `layout.tsx` and everything depending on it for a menu of five links. The
 * prefix is read here, once, and the proxy stays the only other source of truth
 * about what is public — see `lib/public-paths.ts`.
 *
 * The framework gives a tool a fixed navigation down the left, olive-deep, and
 * that is what this is above the medium breakpoint. Below it the same markup
 * lays itself out as a band across the top: a fixed 224px column on a phone
 * leaves nothing for the content. `AppShell` reads `hasNav` to know whether to
 * leave the column its room. */

// "Judges" sits beside "Runs" rather than beside "Advice": both answer "what do
// I already have", where Advice answers "how should I write one".
const LINKS = [
  { href: "/", label: "Evaluate" },
  { href: "/runs", label: "Runs" },
  { href: "/judges", label: "Judges" },
  { href: "/advice", label: "Advice" },
  { href: "/settings/mcp", label: "MCP" },
];

/** Which tab the open page belongs to.
 *
 * `/eval/<id>` is a run's page: it has no entry of its own, but one arrives there
 * from "Runs" and goes back to it. The tab stays lit rather than leaving the
 * navigation with no marker. */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/runs") return pathname.startsWith("/runs") || pathname.startsWith("/eval");
  return pathname.startsWith(href);
}

/** Where the navigation does not belong.
 *
 * `/signin` joins `/shared`: four links to pages that need the very session
 * you are trying to obtain are worse than no menu at all.
 *
 * Not `isOpen` from `public-paths.ts`, which answers a different question —
 * `/format.txt` is an open path that does want the navigation. */
const HIDDEN_ON = ["/shared", "/signin"];

export function hasNav(pathname: string): boolean {
  return !HIDDEN_ON.some((prefix) => pathname.startsWith(prefix));
}

export function AppNav() {
  const pathname = usePathname();
  const hidden = !hasNav(pathname);
  const [email, setEmail] = useState<string | null>(null);

  /** What the other pages will show, loaded while one reads this one.
   *
   * Here and not on the home page: it was the only place doing it, so that
   * arriving straight on "Scenarios" — through a link, a bookmark, a reload —
   * left all the other tabs cold. The navigation, for its part, is rendered by
   * `layout.tsx` on every page.
   *
   * Each `ensure*` asks for nothing if the resource has already served: moving
   * from page to page therefore does not restart four requests every time.
   *
   * `isOpen` and not `hidden`: the latter knows only `/shared`, whereas the
   * question asked here is wider — "does this path read without a session?".
   * Preloading on a public page would send four private requests in a stranger's
   * name, who would see them all fail. The answer lives in `public-paths.ts`,
   * with the proxy that enforces it; duplicating it here would let it drift. */
  const isPublic = isOpen(pathname);
  useEffect(() => {
    if (isPublic) return;
    ensureRunsLoaded();
    ensureTagsLoaded();
    ensureProfileLoaded();
    ensureConnectionsLoaded();
    ensureJudgesLoaded();
  }, [isPublic]);

  useEffect(() => {
    // The hook must be called even on `/shared`, where the navigation does not
    // show — hence the condition here rather than an early return above.
    if (hidden) return;
    getMe()
      .then(({ email }) => setEmail(email))
      .catch(() => setEmail(null));
  }, [hidden]);

  if (hidden) return null;

  return (
    // `z-40` puts it above the content without passing in front of the modals,
    // which are at `z-50`.
    <nav className="sticky top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-3 bg-olive-deep px-6 py-3 text-paper md:fixed md:inset-y-0 md:left-0 md:h-screen md:w-56 md:flex-col md:flex-nowrap md:items-stretch md:gap-y-8 md:overflow-y-auto md:px-5 md:py-6">
      {/* The mark and the collective's name, leading to the collective's site.
          Not to a page of this application: there is no home here other than
          "Evaluate", and a mark leading to the first tab would give two paths to
          the same thing.

          On an olive-deep surface the mark is gold, which is the one place the
          framework allows gold at all, and it deepens under the cursor rather
          than brightening: a mark that lights up when pressed is a mark moving
          the wrong way. The name does not change colour. */}
      <a
        href={POLARIS_SITE}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-2.5"
      >
        <span className="text-gold transition-colors duration-150 group-hover:text-amber-600 group-active:text-amber-700">
          <PolarisMark size={26} />
        </span>
        <span className="font-display text-base leading-tight">Polaris Collective</span>
      </a>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:flex-1 md:flex-col md:items-stretch md:gap-y-1">
        {LINKS.map(({ href, label }) => {
          const current = isCurrent(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              // The open tab is marked by a chartreuse bar, not by chartreuse
              // text: the framework never lets that colour carry a letter.
              className={`border-l-2 py-1 transition-colors duration-150 md:pl-3 ${
                current
                  ? "border-chartreuse font-semibold text-paper max-md:border-l-0 max-md:border-b-2"
                  : "border-transparent text-zinc-300 hover:text-paper max-md:border-l-0"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* As long as the address is not known, nothing: a sign-out button with no
          idea who is signed in says nothing true. */}
      {email && (
        <div className="flex flex-wrap items-center gap-3 text-xs md:flex-col md:items-start md:gap-2">
          <Link
            href="/profile"
            className="max-w-full truncate font-mono text-zinc-300 hover:text-paper"
          >
            {email}
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-full border border-paper/40 px-3 py-1 font-semibold transition-colors duration-150 hover:bg-chartreuse hover:text-ink"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
