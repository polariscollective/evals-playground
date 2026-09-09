import { NextResponse, type NextRequest } from "next/server";
import { callbackFor } from "@/lib/signin-callback";

// This file does **not** authenticate. It routes.
//
// Named `proxy.ts` and not `middleware.ts`: Next 16 renamed the convention, and
// the compatibility fallback that works in development is not enough for the
// deployment — a `middleware.ts` produced a MIDDLEWARE_INVOCATION_FAILED there
// with no further explanation. The export must be called `proxy`, and it is
// named, not default.
//
// The previous version called NextAuth's `auth()` here, and so ran the whole
// library on the edge runtime. That is what produced an opaque
// MIDDLEWARE_INVOCATION_FAILED on the first deployment: when that code fails, the
// platform returns a 500 saying nothing about what was missing.
//
// The real check now lives in the routes, with `requireUser()` — on the Node
// server side, with a session really validated. Here we only look at whether a
// session cookie exists, so as to send an anonymous visitor to the sign-in screen
// rather than let them run into a 401. A forged cookie would pass this door; it
// would pass no route.

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

/** The development short circuit, locked on `NODE_ENV`.
 *
 * The same two conditions as `getSessionEmail` in auth.ts, so that the
 * application has one single switch rather than two armed independently. */
const skipAuthInDev =
  process.env.NODE_ENV !== "production" &&
  process.env.LOCAL_AUTHENTICATION_NEEDED === "false";

export function proxy(request: NextRequest) {
  if (skipAuthInDev) return NextResponse.next();

  const signedIn = SESSION_COOKIES.some(
    (name) => request.cookies.get(name)?.value,
  );
  if (signedIn) return NextResponse.next();

  // An API route answers 401; a page leaves for the sign-in screen. Returning a
  // sign-in page to a `fetch` would produce HTML where the code expects JSON, and
  // the error would be unreadable.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // The requested path travels along, so a bookmark to /runs/xyz comes back
  // to /runs/xyz rather than dropping the visitor on the home page — unless
  // it would only repeat `login`'s own fallback, which is what `callbackFor`
  // decides. It cannot become an open redirect: `login` hands it to Auth.js,
  // whose default `redirect` callback answers `baseUrl` for any origin that
  // is not ours.
  const signin = new URL("/signin", request.nextUrl.origin);
  const callback = callbackFor(request.nextUrl.pathname, request.nextUrl.search);
  if (callback) signin.searchParams.set("callbackUrl", callback);
  return NextResponse.redirect(signin);
}

// This literal must stay equal to what `proxyMatcher()` in `lib/public-paths.ts`
// returns: Next demands a constant here and ignores a computed value.
// `public-paths.test.mts` holds the two in agreement.
export const config = {
  matcher: [
    "/((?!api/auth(?:/|$)|signin(?:/|$)|shared(?:/|$)|inspect-view(?:/|$)|mcp(?:/|$)|\\.well-known(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|icon\\.svg$|advice\\.txt$|format\\.txt$).*)",
  ],
};
