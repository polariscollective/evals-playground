"use client";

import { usePathname } from "next/navigation";
import { AppNav, hasNav } from "@/components/AppNav";
import { PublicHeader } from "@/components/PublicHeader";

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
 * A page with no navigation still says whose it is: the shared pages get the
 * mark above their content. Sign-in is the exception — it carries the mark in
 * the middle of the page already, and a second one over it would be two. */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const navigated = hasNav(pathname);

  return (
    <>
      <AppNav />
      <div className={`flex min-h-screen flex-col ${navigated ? "md:pl-56" : ""}`}>
        {!navigated && !pathname.startsWith("/signin") && <PublicHeader />}
        {children}
      </div>
    </>
  );
}
