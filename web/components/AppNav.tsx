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

/** The private application's bar, absent from `/shared`.
 *
 * "Publishing opens a run, not the application" — a stranger arriving on a
 * published run must not see a menu towards pages that demand a session, nor
 * under what address somebody else is signed in.
 *
 * A client component rather than a route group: the second would have moved
 * `layout.tsx` and everything depending on it for a menu of four links. The
 * prefix is read here, once, and the proxy stays the only other source of truth
 * about what is public — see `lib/public-paths.ts`. */

const LINKS = [
  { href: "/", label: "Evaluate" },
  { href: "/runs", label: "Runs" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/settings/connections", label: "Connections" },
];

/** Which tab the open page belongs to.
 *
 * `/eval/<id>` is a run's page: it has no entry of its own, but one arrives there
 * from "Runs" and goes back to it. The tab stays lit rather than leaving the bar
 * with no marker. */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/runs") return pathname.startsWith("/runs") || pathname.startsWith("/eval");
  return pathname.startsWith(href);
}

export function AppNav() {
  const pathname = usePathname();
  const hidden = pathname.startsWith("/shared");
  const [email, setEmail] = useState<string | null>(null);

  /** What the other pages will show, loaded while one reads this one.
   *
   * Here and not on the home page: it was the only place doing it, so that
   * arriving straight on "Scenarios" — through a link, a bookmark, a reload —
   * left all the other tabs cold. The bar, for its part, is rendered by
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
  }, [isPublic]);

  useEffect(() => {
    // The hook must be called even on `/shared`, where the bar does not show —
    // hence the condition here rather than an early return above.
    if (hidden) return;
    getMe()
      .then(({ email }) => setEmail(email))
      .catch(() => setEmail(null));
  }, [hidden]);

  if (hidden) return null;

  return (
    // `bg-background` is not decorative: a sticky bar with no opaque ground lets
    // the form scroll underneath. And `z-40` puts it above the content without
    // passing in front of the modals, which are at `z-50`.
    <nav className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-background px-8 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* The star and the collective's name, taken from the header of
            polariscollective.org — same outline, same olive, same serif. It is not
            a link: the application has no home page other than "Evaluate", and a
            logo leading to the first tab would give two paths to the same
            thing. */}
        <span className="flex items-center gap-2 font-serif text-base text-teal-700">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className="shrink-0"
          >
            <path
              d="M7 0.5 L7.6 6.4 L13.5 7 L7.6 7.6 L7 13.5 L6.4 7.6 L0.5 7 L6.4 6.4 Z"
              fill="currentColor"
            />
          </svg>
          Polaris Collective
        </span>
        <span aria-hidden="true" className="h-4 w-px bg-zinc-300" />
        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent(pathname, href) ? "page" : undefined}
            className={
              isCurrent(pathname, href)
                ? "font-medium text-teal-700"
                : "font-medium text-zinc-500 hover:text-zinc-900"
            }
          >
            {label}
          </Link>
        ))}
      </div>
      {/* As long as the address is not known, nothing: a sign-out button with no
          idea who is signed in says nothing true. */}
      {email && (
        <div className="flex items-center gap-3">
          <span className="text-zinc-500">Logged in as</span>
          <Link href="/profile" className="font-medium hover:underline">
            {email}
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded border px-3 py-1 hover:bg-zinc-100"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
