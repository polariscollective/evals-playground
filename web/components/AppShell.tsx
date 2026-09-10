"use client";

import { usePathname } from "next/navigation";
import { AppNav, hasNav } from "@/components/AppNav";

/** The frame the framework asks of a tool: a fixed navigation down the left, and
 * the content taking the rest of the width.
 *
 * It exists because the offset and the navigation have to agree. `AppNav`
 * renders nothing on `/shared` and `/signin`, and a page that pushed itself
 * 224px right of a navigation that is not there would sit in an empty gutter.
 * Both read the same `hasNav`.
 *
 * Only above the medium breakpoint: below it the navigation is a band across the
 * top, in the flow, and there is nothing to offset.
 *
 * A page with no navigation still says whose it is, but it says so itself: the
 * shared pages render `PublicHeader` with their own read-only line and their own
 * way back in, which this component knows nothing about. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navigated = hasNav(pathname);

  return (
    <>
      <AppNav />
      <div className={`flex min-h-screen flex-col ${navigated ? "md:pl-56" : ""}`}>
        {children}
      </div>
    </>
  );
}
