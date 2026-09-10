"use client";

import { useState } from "react";
import type { ReactNode } from "react";

/** A box one folds away by clicking its heading.
 *
 * Open to start with: what one comes to read is there without a gesture, and
 * folding is only useful once one has read.

 * The heading takes the whole width left over, so that the click lands anywhere
 * on the line rather than on the words alone — a heading of two words in a box
 * of a thousand pixels is a small target for a gesture one repeats. What it does
 * not take is the room the aside needs: several of these boxes carry a button
 * there ("Edit", "Save"), and a header clickable edge to edge would swallow
 * them.
 *
 * What is folded away is not rendered at all: the foldable boxes here carry
 * tables and transcripts, and keeping them mounted for the sole beauty of an
 * animation would make one pay for a reading one has put away.
 */
export function Collapsible({
  title,
  aside,
  className,
  bodyClassName,
  pinned = false,
  children,
}: {
  /** The heading with its own classes — `eyebrow` on the reading boxes,
   *  `text-sm font-medium` on the fields: each box keeps its own. */
  title: ReactNode;
  /** What stands to the right of the heading. Stays visible once folded:
   *  "judged by claude-x", "Edit", read precisely when the rest is put away —
   *  and "Edit" reopens the box on the way in. */
  aside?: ReactNode;
  className?: string;
  /** The spacing between the children, the one the box carried before they moved
   *  into a block of their own, so that nothing shifts once open. */
  bodyClassName?: string;
  /** Forced open, with no chevron and no toggle. It is what a field being edited
   *  needs: folding away what one is writing would make the typing disappear
   *  under one's fingers. */
  pinned?: boolean;
  children: ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  const open = pinned || !folded;

  return (
    <section className={className}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {pinned ? (
          title
        ) : (
          <button
            type="button"
              onClick={() => setFolded((current) => !current)}
              aria-expanded={open}
            className="group flex flex-1 cursor-pointer items-baseline gap-1.5 text-left"
          >
            <svg
              viewBox="0 0 10 10"
              aria-hidden="true"
              className={`h-2.5 w-2.5 shrink-0 text-zinc-400 transition-transform group-hover:text-zinc-700 ${
                  open ? "" : "-rotate-90"
              }`}
            >
              <path
                d="M1.5 3.5 L5 7 L8.5 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {title}
          </button>
        )}
        {aside}
      </div>
        {open && <div className={bodyClassName}>{children}</div>}
    </section>
  );
}
