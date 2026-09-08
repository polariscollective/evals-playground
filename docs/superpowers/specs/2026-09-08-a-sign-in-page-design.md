# A sign-in page of our own

The application has never had one. A visitor without a session is handed to
Auth.js, which renders its own page, and that page belongs to a different
product — grey card, its own font stack, a Google mark fetched from
`authjs.dev`. Nothing of the cream and olive that every other screen wears.

This work replaces both default pages — the one that asks, and the one that
refuses — with a single page of ours.

## Where this comes from

`web/proxy.ts:51` sends anyone without a session cookie to
`/api/auth/signin`. That is the built-in page. Auth.js renders it with Preact
and inlines its own stylesheet, so nothing in `globals.css` reaches it; the
provider button loads its logo over the network from `authjs.dev/img/providers`.

The refusal has a second page, also built in. `isAllowedEmail` returning false
throws `AccessDenied`, and `@auth/core` redirects to
`/api/auth/error?error=AccessDenied`. For anyone outside the collective this is
the *only* screen they will ever see, and it is the plainer of the two.

The two pages are the whole of the application's front door, and neither of
them is ours.

## What the page says

One route, `web/app/signin/page.tsx`, a server component. A single centred
column on the cream background — no card, no border, no panel. The page holds
four things and nothing else:

```
                    EVALS PLAYGROUND         .eyebrow — olive small caps

                 ✦  Polaris Collective       star + Spectral, text-teal-700

           That address does not open …      only when ?error= says so

              ┌──────────────────────────┐
              │  Continue with Google    │   rounded bg-teal-700 px-4 py-2
              └──────────────────────────┘

           To request access, please reach
           out to sam@polariscollective.org  always, mailto: in olive
```

Every one of those styles already exists. `.eyebrow` is the site's section
heading, defined in `globals.css`. `rounded bg-teal-700 px-4 py-2 text-white
hover:bg-teal-800` is the application's primary button, taken from the launch
button in `app/eval/[runId]/page.tsx:389`. The page invents no visual language;
it only stops using someone else's.

The contact address is not new either. `docs/evals-methodology.md:55` already
publishes `sam@polariscollective.org` as the way to reach the collective, in
exactly this `mailto:` form. Introducing a second address for the same purpose
is how two of them start drifting.

That line is permanent — it does not wait for a refusal. Which is what lets the
refusal message stay one sentence: the error says what happened, and the line
below it already says what to do about it.

`AppNav` hides on `/signin`, as it already hides on `/shared`. Four links to
pages that require the session you are trying to obtain are worse than no bar
at all. The predicate stays an explicit list of prefixes rather than `isOpen`,
because `isOpen` is a different question — `/prompt` and `/validate` are open
paths that do want the bar.

### The star, drawn once

The star exists twice today: as a `<path>` inside `AppNav.tsx`, and as the
static `app/icon.svg`. The static file cannot share anything — it is served
straight off disk and never passes through the bundler — but the page and the
bar can, and a third hand-copied `d` attribute is where the three of them would
start to disagree.

So `web/components/PolarisStar.tsx`: a function component taking a `size`, no
hooks and no state, which makes it usable from `AppNav` (a client component)
and from the page (a server one) without qualification. The bar renders it at
14px, the page at 22.

## Signing in

The button is a `<form>` posting to a server action. `signIn` from Auth.js runs
on the server only, which is the same constraint that put `logout` in
`web/lib/auth-actions.ts`; `login` joins it there rather than being written
inline in the page.

```ts
export async function login(formData: FormData) {
  const callbackUrl = formData.get("callbackUrl");
  await signIn("google", {
    redirectTo: typeof callbackUrl === "string" && callbackUrl ? callbackUrl : "/",
  });
}
```

`callbackUrl` travels in a hidden input rather than being read from the page's
own props inside the action, because a server action does not see the request
that rendered the page.

### Where you land, and why it is not an open redirect

Today the proxy attaches no `callbackUrl` at all. Following a bookmark to
`/runs/xyz` without a session bounces you to sign-in and then drops you on `/`,
having quietly forgotten what you asked for. The proxy will now carry the
requested path across:

```ts
const signin = new URL("/signin", request.nextUrl.origin);
signin.searchParams.set(
  "callbackUrl",
  `${request.nextUrl.pathname}${request.nextUrl.search}`,
);
return NextResponse.redirect(signin);
```

A destination taken from the request and handed back to a redirect is the shape
of an open redirect, so it is worth naming why this one is not. Auth.js runs
every `redirectTo` through its `redirect` callback, and the default
(`@auth/core/lib/init.js:13`) returns `baseUrl` for anything whose origin is not
ours, prefixing bare paths with `baseUrl` instead of trusting them. A crafted
`?callbackUrl=https://elsewhere.example` lands on the home page. The value we
send is a path from our own URL in the first place; the callback is what makes
a forged one harmless too.

## When it goes wrong

`web/lib/signin-error.ts` holds a pure function, `signInMessage(error)`, mapping
the `?error=` parameter to the sentence shown above the button — or to `null`,
which is the ordinary case where the page just asks.

| `?error=` | sentence |
|---|---|
| `AccessDenied` | That address does not open the application. |
| `Configuration` | Sign-in is not configured on this deployment. |
| anything else | Something went wrong signing in. Try again. |

Three cases, because three of them are true and telling them apart matters.
`Configuration` is what Auth.js reports when a variable is missing from the
environment — the same failure `requireUser()` already names explicitly for API
routes rather than letting the platform answer 500. Folding it into
`AccessDenied` would tell the whole collective it had been struck off the list
on the day someone forgot to set `AUTH_SECRET`.

The function is pure and lives in `lib/`, which is what makes it the one part of
this page a test can hold.

## The routing

Four edits, all of them saying the same thing in the place that has to hear it.

**`web/auth.ts`** gains `pages: { signIn: "/signin", error: "/signin" }`. Both
keys, not just the first: `AccessDenied` extends `AuthError` directly rather
than `SignInError`, so its `kind` is `"error"` and `@auth/core` routes it to
`pages.error`. Setting only `pages.signIn` would leave the refusal — the state
this work most wants to own — on the default card.

**`web/proxy.ts`** redirects to `/signin`, and its `matcher` literal gains
`signin(?:/|$)`. Without the second half the door would send visitors to a page
the door itself refuses, once per redirect, forever.

**`web/lib/public-paths.ts`** gains `"signin"` in `OPEN_PREFIXES`, the same
status `api/auth` already has and for the same reason: no one can sign in
through a page that requires being signed in. The file's own warning applies
unchanged — opening a path only removes the door, and `/signin` is safe behind
it because it reads nothing and writes nothing.

**`web/app/mcp/authorize/route.ts:79`** points at `/signin` too. It would keep
working untouched — with `pages.signIn` set, `@auth/core` redirects
`/api/auth/signin` onward and preserves `callbackUrl`
(`@auth/core/lib/pages/index.js:56`) — but leaving it would mean two routes
naming two different front doors. Its `getPublicOrigin` comment stays exactly as
it is; the reason it builds an absolute `callbackUrl` has not changed.

## What this work does not do

**The favicon.** It was measured and deliberately left alone. `app/icon.svg` and
`app/favicon.ico` already carry the collective's star in the right palette, from
`ee37e26`. At 16px the star's arms do fade into the cream disc — the comment in
`icon.svg` says so itself — and inverting the two fills would fix it without
changing the drawing. Rendering that variant next to the current one settled it
the other way: the badge stays as it is. Recorded here so the question is not
reopened as if it had never been asked.

**The French comments** in every file this touches. They stay. New prose here is
English, per the workspace `CLAUDE.md`; translating what is already written is a
separate change with its own commit.

## Tests

`web/lib/public-paths.test.mts` gains `/signin` among the paths that pass the
door and `/signinx` among those that do not. Its third test — the one comparing
the hand-written `matcher` literal in `proxy.ts` against what `proxyMatcher()`
produces — is what keeps this from being two edits that drift apart, and it
fails until both are made.

`web/lib/signin-error.test.mts` is new: the three sentences, plus `undefined`
returning `null`. It is the fifty-first, so the count written into the
repository's `CLAUDE.md` moves with it — a number that stops matching the tree
is worse than no number.

Nothing else is testable here. The page is JSX, and this repository tests no
components — its fifty `.test.mts` files all sit in `lib/`, over pure functions.
Pulling `signInMessage` out of the page rather than writing the mapping inline
is what puts the one decision the page makes on the tested side of that line.
