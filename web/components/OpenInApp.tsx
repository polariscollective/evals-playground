// The way back in, from a page that does not require being in.
//
// A shared address is read by two kinds of visitor, and the same word does not
// serve both. Somebody with no session needs the door; somebody who already has
// one is looking at a read-only copy of a page they can open properly, and
// telling them to "log in" would be telling them to do something they have
// already done.
//
// So the destination is one path and the label is two, decided by the session
// on the server. Signed out, the link goes through `/signin` carrying that path
// as its callback, and Auth.js brings the visitor back to it once Google
// answers — see `login` (`lib/auth-actions.ts`), which is also where the reason
// this cannot become an open redirect is written down.
//
// The path is the INTERNAL counterpart of the page holding this link, never the
// shared one: coming back to `/shared/…` after signing in would land the
// visitor on the same read-only copy, having gained nothing for the trip.
import Link from "next/link";

export function OpenInApp({
  href,
  signedIn,
}: {
  /** Where to land: the internal page this shared one is a copy of. */
  href: string;
  signedIn: boolean;
}) {
  const destination = signedIn
    ? href
    : `/signin?callbackUrl=${encodeURIComponent(href)}`;

  return (
    <Link
      href={destination}
      className="shrink-0 rounded-full border border-zinc-300 px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-50"
    >
      {signedIn ? "Open in the app" : "Log in"}
    </Link>
  );
}
