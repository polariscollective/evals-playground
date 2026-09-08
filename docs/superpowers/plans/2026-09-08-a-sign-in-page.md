# A Sign-In Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Auth.js's two built-in screens — the one that asks for a sign-in and the one that refuses it — with a single page of our own, in the application's palette.

**Architecture:** A server component at `/signin` posts to a server action that calls Auth.js `signIn("google")`. `auth.ts` points both `pages.signIn` and `pages.error` at that route, so the refusal lands there too; a pure function in `lib/` turns the `?error=` parameter into the sentence shown. The proxy, the open-path list and the MCP authorize route all learn the new address.

**Tech Stack:** Next 16 (App Router, server actions, typed routes), NextAuth v5 beta / `@auth/core`, Tailwind v4, `node --test` over `.mts` files.

**Design spec:** `docs/superpowers/specs/2026-09-08-a-sign-in-page-design.md`

## Global Constraints

- **Everything written in this plan is in English** — file names, identifiers, comments, commit messages, UI copy. This is the workspace `CLAUDE.md` rule.
- **Do not translate the French comments already in the files you touch.** `proxy.ts`, `public-paths.ts`, `auth-actions.ts`, `AppNav.tsx` and `app/mcp/authorize/route.ts` all carry French prose. Leave every line of it exactly as it is, including where it becomes slightly incomplete — a separate change handles that. Add your new comments in English alongside.
- **Exact UI copy**, no paraphrase:
  - eyebrow: `Evals Playground` (`.eyebrow` uppercases it in CSS)
  - name: `Polaris Collective`
  - button: `Continue with Google`
  - access line: `To request access, please reach out to ` + the link `sam@polariscollective.org`
  - `AccessDenied`: `That address does not open the application.`
  - `Configuration`: `Sign-in is not configured on this deployment.`
  - any other error: `Something went wrong signing in. Try again.`
- **Palette by class, never by hex.** `globals.css` redefines the Tailwind scales; `text-teal-700`, `text-zinc-500`, `bg-teal-700` already resolve to the cream-and-olive values. A literal colour in a component would not follow them.
- **Verification, run from the repository root:**
  - `npm --prefix web test`
  - `npm --prefix web run lint`
  - `npm --prefix web run build`
  There is no test CI in this repository — `.github/workflows/` holds only a deploy job — so these three passing locally is what "green" means.
- **Commit trailers**, on every commit in this plan:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_019STYMJXFZWWzCpBrJmkwSG
  ```

## File Structure

| File | Responsibility |
|---|---|
| `web/lib/signin-error.ts` | **create** — `signInMessage`, the only decision the page makes, kept pure so a test can hold it |
| `web/lib/signin-error.test.mts` | **create** — its four cases |
| `web/components/PolarisStar.tsx` | **create** — the star's `d`, written once for the bar and the page |
| `web/app/signin/page.tsx` | **create** — the page itself |
| `web/lib/auth-actions.ts` | modify — `login` joins `logout`, for the same server-only reason |
| `web/auth.ts` | modify — `pages: { signIn, error }` |
| `web/proxy.ts` | modify — redirect target, `callbackUrl`, and the `matcher` literal |
| `web/lib/public-paths.ts` | modify — `"signin"` in `OPEN_PREFIXES` |
| `web/lib/public-paths.test.mts` | modify — `/signin` open, `/signinx` closed |
| `web/app/mcp/authorize/route.ts` | modify — one line, the same front door |
| `web/components/AppNav.tsx` | modify — uses `PolarisStar`, hides on `/signin` |
| `CLAUDE.md` | modify — the test-file count, 50 → 51 |

Ordering is deliberate: the page must exist and be reachable **before** anything routes to it. Task 4 is the switch-over, and it comes last.

---

### Task 1: The sentence a failed sign-in shows

**Files:**
- Create: `web/lib/signin-error.ts`
- Test: `web/lib/signin-error.test.mts`
- Modify: `CLAUDE.md:10`

**Interfaces:**
- Consumes: nothing.
- Produces: `signInMessage(error: string | string[] | undefined): string | null`, imported by `web/app/signin/page.tsx` in Task 3.

Why a `string[]` in the signature: Next hands `searchParams` values as `string | string[] | undefined`, because a query string can carry the same key twice (`?error=a&error=b`). Normalising inside the function rather than in the page puts that edge case on the tested side.

- [ ] **Step 1: Write the failing test**

Create `web/lib/signin-error.test.mts`:

```ts
// Telling a refused address from a broken deployment is the whole point of
// this function: one is the visitor's problem, the other is ours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { signInMessage } from "./signin-error.ts";

test("no error means no sentence", () => {
  assert.equal(signInMessage(undefined), null);
  assert.equal(signInMessage(""), null);
});

test("a refused address is not a missing variable", () => {
  const denied = signInMessage("AccessDenied");
  const misconfigured = signInMessage("Configuration");
  assert.notEqual(denied, misconfigured);
  assert.equal(denied, "That address does not open the application.");
  assert.equal(misconfigured, "Sign-in is not configured on this deployment.");
});

test("anything else falls back to one generic sentence", () => {
  for (const reason of ["OAuthCallbackError", "Verification", "wat"]) {
    assert.equal(
      signInMessage(reason),
      "Something went wrong signing in. Try again.",
      reason,
    );
  }
});

test("a query key repeated twice reads as its first value", () => {
  assert.equal(
    signInMessage(["AccessDenied", "Configuration"]),
    signInMessage("AccessDenied"),
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web test`

Expected: FAIL — `Cannot find module` / `signInMessage is not a function`, because `signin-error.ts` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `web/lib/signin-error.ts`:

```ts
/** The sentence a failed sign-in puts above the button, or null for none.
 *
 * Three cases, because three of them are true. `Configuration` is what
 * Auth.js reports when a variable is missing from the deployment — the same
 * failure `requireUser()` already names rather than letting the platform
 * answer 500. Folding it into `AccessDenied` would tell the whole collective
 * it had been struck off the list on the day someone forgot `AUTH_SECRET`.
 *
 * Auth.js passes the reason as `?error=`, and Next gives a query value as an
 * array when the key appears twice. Normalising here rather than in the page
 * keeps the whole decision on the side a test can reach. */
export function signInMessage(
  error: string | string[] | undefined,
): string | null {
  const reason = Array.isArray(error) ? error[0] : error;
  if (!reason) return null;
  if (reason === "AccessDenied") {
    return "That address does not open the application.";
  }
  if (reason === "Configuration") {
    return "Sign-in is not configured on this deployment.";
  }
  return "Something went wrong signing in. Try again.";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix web test`

Expected: PASS — all four `signin-error` tests, and the fifty files that were already green.

- [ ] **Step 5: Move the count in `CLAUDE.md`**

This file is French. Change the number, nothing else — line 10:

```
    npm --prefix web test   # everything else — 51 .test.mts files
```

Confirm the count matches the tree:

Run: `find web -name "*.test.mts" -not -path "*/node_modules/*" | wc -l`
Expected: `51`

- [ ] **Step 6: Commit**

```bash
git add web/lib/signin-error.ts web/lib/signin-error.test.mts CLAUDE.md
git commit -F - <<'MSG'
feat: a refused address and a missing variable do not say the same thing

Auth.js reports both as `?error=`, and the sign-in page has to tell them
apart. Folding `Configuration` into `AccessDenied` would tell the whole
collective it had been struck off the list on the day someone forgot to
set AUTH_SECRET.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019STYMJXFZWWzCpBrJmkwSG
MSG
```

---

### Task 2: The star drawn once, and the bar absent from the door

**Files:**
- Create: `web/components/PolarisStar.tsx`
- Modify: `web/components/AppNav.tsx` (the `<svg>` at lines ~96-108, and `hidden` at line ~68)

**Interfaces:**
- Consumes: nothing.
- Produces: `PolarisStar({ size }: { size?: number })`, default `size` 14, imported by `AppNav.tsx` here and by `web/app/signin/page.tsx` in Task 3.

No `"use client"` on `PolarisStar`: it has no hooks and no state, which is what lets `AppNav` (a client component) and the page (a server one) both import it.

This task changes nothing a user can see. `AppNav` must render exactly as before on every existing route — the star at 14px, `currentColor`, `aria-hidden`, `shrink-0`.

- [ ] **Step 1: Create the component**

Create `web/components/PolarisStar.tsx`:

```tsx
/** The collective's star, from the header of polariscollective.org.
 *
 * One `d` for the two places that draw it — the navigation bar and the
 * sign-in page. `app/icon.svg` holds a third copy and cannot share this one:
 * it is served straight off disk and never passes through the bundler, which
 * is exactly what its own comment warns about.
 *
 * `currentColor` rather than a fill of its own: every caller already sets a
 * text colour, and the star is meant to follow it. */
export function PolarisStar({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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
  );
}
```

- [ ] **Step 2: Use it from `AppNav`**

In `web/components/AppNav.tsx`, add the import next to the others at the top:

```tsx
import { PolarisStar } from "@/components/PolarisStar";
```

Then replace the inline `<svg>…</svg>` block inside the `<span className="flex items-center gap-2 font-serif text-base text-teal-700">` with:

```tsx
          <PolarisStar />
```

Leave the French comment above that `<span>` exactly as it is.

- [ ] **Step 3: Hide the bar on `/signin`**

Still in `web/components/AppNav.tsx`. Above the `AppNav` function — after the `isCurrent` helper — add:

```tsx
/** Where the bar does not belong.
 *
 * `/signin` joins `/shared`: four links to pages that need the very session
 * you are trying to obtain are worse than no bar at all.
 *
 * Not `isOpen` from `public-paths.ts`, which answers a different question —
 * `/prompt` and `/validate` are open paths that do want the bar. */
const HIDDEN_ON = ["/shared", "/signin"];
```

Then change the one line that computes `hidden`:

```tsx
  const hidden = HIDDEN_ON.some((prefix) => pathname.startsWith(prefix));
```

Do not touch the French docstring at the top of the file, nor the French comment on the `useEffect` just below.

- [ ] **Step 4: Verify nothing moved**

Run: `npm --prefix web run lint`
Expected: no errors.

Run: `npm --prefix web run build`
Expected: build succeeds.

Then look at it. Run `./scripts/dev.sh`, open `http://localhost:3000/`, and confirm the bar still shows the star, `Polaris Collective`, and the four links, unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/components/PolarisStar.tsx web/components/AppNav.tsx
git commit -F - <<'MSG'
refactor: the star has one `d`, not a copy per caller

The sign-in page is about to draw it too. A third hand-copied path is
where the three of them would start to disagree.

The bar also learns to stay out of /signin, for the reason it already
stays out of /shared.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019STYMJXFZWWzCpBrJmkwSG
MSG
```

---

### Task 3: The page

**Files:**
- Create: `web/app/signin/page.tsx`
- Modify: `web/lib/auth-actions.ts`

**Interfaces:**
- Consumes: `signInMessage` (Task 1), `PolarisStar` (Task 2).
- Produces: the route `/signin`, and `login(formData: FormData): Promise<void>` exported from `web/lib/auth-actions.ts`.

After this task the page exists and can be visited directly, but nothing routes to it yet — the proxy still sends visitors to `/api/auth/signin`. That switch is Task 4. This keeps the tree working at every commit.

- [ ] **Step 1: Add the `login` server action**

In `web/lib/auth-actions.ts`, widen the import on line 3:

```ts
import { signIn, signOut } from "@/auth";
```

and append, after `logout`:

```ts
/** Start the Google exchange, and come back where the visitor was heading.
 *
 * `signIn` runs on the server only — the same constraint that put `logout`
 * here rather than in the bar.
 *
 * `callbackUrl` arrives through a hidden input because a server action does
 * not see the request that rendered the page. It cannot become an open
 * redirect: Auth.js runs every `redirectTo` through its `redirect` callback,
 * and the default (`@auth/core/lib/init.js`) prefixes a bare path with the
 * base URL and answers `baseUrl` for any other origin. */
export async function login(formData: FormData) {
  const callbackUrl = formData.get("callbackUrl");
  await signIn("google", {
    redirectTo:
      typeof callbackUrl === "string" && callbackUrl ? callbackUrl : "/",
  });
}
```

Leave the French docstring on `logout` untouched.

- [ ] **Step 2: Write the page**

Create `web/app/signin/page.tsx`:

```tsx
// The application's front door, and the only screen someone outside the
// collective ever sees.
//
// Auth.js renders a page for both of these — the one that asks and the one
// that refuses — and neither wears the palette: it inlines its own stylesheet
// and fetches the provider logo from authjs.dev. `pages` in `auth.ts` points
// both at this route, and `signInMessage` is what tells the two apart.
//
// Every class here already exists. `.eyebrow` is the site's section heading
// from globals.css, and the button is the primary one from the run page. The
// page invents no visual language; it only stops using someone else's.
import type { Metadata } from "next";
import { PolarisStar } from "@/components/PolarisStar";
import { login } from "@/lib/auth-actions";
import { signInMessage } from "@/lib/signin-error";

export const metadata: Metadata = {
  title: "Sign in — Evals Playground",
};

export default async function SignIn({ searchParams }: PageProps<"/signin">) {
  const { error, callbackUrl } = await searchParams;
  const message = signInMessage(error);
  const destination = Array.isArray(callbackUrl) ? callbackUrl[0] : callbackUrl;

  return (
    // `flex-1` and not a fixed height: `body` is `min-h-full flex flex-col`,
    // so growing into it is what centres the column on the viewport.
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <p className="eyebrow">Evals Playground</p>

      <span className="flex items-center gap-3 font-serif text-2xl text-teal-700">
        <PolarisStar size={22} />
        Polaris Collective
      </span>

      {message && <p className="text-sm text-zinc-600">{message}</p>}

      <form action={login}>
        <input type="hidden" name="callbackUrl" value={destination ?? ""} />
        <button
          type="submit"
          className="rounded bg-teal-700 px-4 py-2 text-white hover:bg-teal-800"
        >
          Continue with Google
        </button>
      </form>

      {/* Permanent, not conditional on a refusal. Which is what lets the
          message above stay one sentence: it says what happened, this says
          what to do about it. The address is the one already published in
          docs/evals-methodology.md — a second one would drift from it. */}
      <p className="text-sm text-zinc-500">
        To request access, please reach out to{" "}
        <a
          href="mailto:sam@polariscollective.org"
          className="text-teal-700 hover:underline"
        >
          sam@polariscollective.org
        </a>
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Build, so Next learns the route**

`PageProps<"/signin">` resolves against `web/.next/types/routes.d.ts`, which Next regenerates when it discovers the new page. Until then TypeScript does not know the route exists.

Run: `npm --prefix web run build`
Expected: build succeeds. If the first run reports that `"/signin"` does not satisfy `AppRoutes`, run it a second time — the first pass is what writes the route into `routes.d.ts`.

Confirm: `grep -o '"/signin"' web/.next/types/routes.d.ts | head -1` prints `"/signin"`.

Run: `npm --prefix web run lint`
Expected: no errors.

- [ ] **Step 4: Look at the page**

Run `./scripts/dev.sh` and open each of these:

- `http://localhost:3000/signin` — eyebrow, star, name, button, access line. No navigation bar. Centred on the cream.
- `http://localhost:3000/signin?error=AccessDenied` — the sentence `That address does not open the application.` appears above the button.
- `http://localhost:3000/signin?error=Configuration` — the other sentence.
- `http://localhost:3000/signin?error=wat` — the generic one.

`.env` has `LOCAL_AUTHENTICATION_NEEDED=false`, so the proxy waves everything through and these URLs are reachable as they are. Do not click the button in dev unless `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are filled and `http://localhost:3000/api/auth/callback/google` is a registered redirect URI — the round trip is exercised in Task 4's manual check instead.

- [ ] **Step 5: Commit**

```bash
git add web/app/signin/page.tsx web/lib/auth-actions.ts
git commit -F - <<'MSG'
feat: a sign-in page in the collective's own palette

Auth.js renders its own, with its own stylesheet and a provider logo
fetched from authjs.dev. Nothing on it belongs to this application.

The page carries a permanent line saying where to ask for access, which
is what lets a refusal stay a single sentence.

Nothing routes here yet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019STYMJXFZWWzCpBrJmkwSG
MSG
```

---

### Task 4: Every door points at it

**Files:**
- Modify: `web/auth.ts` (after `providers: [Google],`)
- Modify: `web/proxy.ts` (the redirect at line ~51, and the `matcher` literal at line ~57)
- Modify: `web/lib/public-paths.ts` (`OPEN_PREFIXES`)
- Modify: `web/lib/public-paths.test.mts` (both path lists)
- Modify: `web/app/mcp/authorize/route.ts:79`

**Interfaces:**
- Consumes: the route `/signin` from Task 3.
- Produces: nothing further depends on this.

The four edits say the same thing in the four places that have to hear it. `public-paths.test.mts` already holds the proxy's hand-written `matcher` literal against what `proxyMatcher()` produces, so a half-done switch fails rather than drifting.

- [ ] **Step 1: Write the failing test**

In `web/lib/public-paths.test.mts`, add `"/signin"` to the list in the first test, right after `"/api/auth/signin"`:

```ts
    "/api/auth/signin",
    // The page that asks. Without this the door would send visitors to a
    // page the door itself refuses, once per redirect, forever.
    "/signin",
```

and add `"/signinx"` to the list in the second test, after `"/mcp-secrets"`:

```ts
    "/mcp-secrets",
    "/signinx",
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web test`

Expected: FAIL — `les chemins ouverts passent la porte sans session` reports `/signin`, because `OPEN_PREFIXES` does not contain it yet.

- [ ] **Step 3: Open the path**

In `web/lib/public-paths.ts`, insert into `OPEN_PREFIXES` immediately after the `"api/auth"` entry and its French comment:

```ts
  // The page that asks. Same status as `api/auth`, and for the same reason:
  // no one can sign in through a page that requires being signed in. Safe
  // behind an open door — it reads nothing and writes nothing.
  "signin",
```

- [ ] **Step 4: Run the test to verify one half passes and the other fails**

Run: `npm --prefix web test`

Expected: the two path-list tests now pass, and `le littéral du proxy est exactement celui que la liste produit` FAILS — the literal in `proxy.ts` has not been updated. This failure is the point of that test.

- [ ] **Step 5: Update the proxy**

In `web/proxy.ts`, replace the single redirect line

```ts
  return NextResponse.redirect(new URL("/api/auth/signin", request.nextUrl.origin));
```

with

```ts
  // The requested path travels along, so a bookmark to /runs/xyz comes back
  // to /runs/xyz rather than dropping the visitor on the home page. It cannot
  // become an open redirect: `login` hands it to Auth.js, whose default
  // `redirect` callback answers `baseUrl` for any origin that is not ours.
  const signin = new URL("/signin", request.nextUrl.origin);
  signin.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(signin);
```

Then replace the `matcher` literal, in the same file, with exactly this string:

```ts
export const config = {
  matcher: [
    "/((?!api/auth(?:/|$)|signin(?:/|$)|prompt(?:/|$)|validate(?:/|$)|scenario-advice(?:/|$)|shared(?:/|$)|inspect-view(?:/|$)|mcp(?:/|$)|\\.well-known(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$|icon\\.svg$).*)",
  ],
};
```

Leave the long French comment block at the top of the file, and the French comment above `config`, untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm --prefix web test`
Expected: PASS, all three `public-paths` tests included.

- [ ] **Step 7: Point Auth.js at the page**

In `web/auth.ts`, insert after `providers: [Google],`:

```ts
  // Both keys, not just the first. `AccessDenied` — what the `signIn`
  // callback below raises — extends `AuthError` directly rather than
  // `SignInError`, so its `kind` is "error" and Auth.js routes it to
  // `pages.error`. Setting only `pages.signIn` would leave the refusal on
  // Auth.js's own card, which is the one screen someone outside the
  // collective ever sees.
  pages: { signIn: "/signin", error: "/signin" },
```

Leave the French comments on `trustHost` and on the `signIn` callback untouched.

- [ ] **Step 8: Point the MCP authorize route at the same door**

In `web/app/mcp/authorize/route.ts`, line 79, change only the path:

```ts
    const signin = new URL("/signin", origin);
```

Leave the French comment above it exactly as it is — the reason it builds an absolute `callbackUrl` from `getPublicOrigin` has not changed, and the line below that sets `callbackUrl` stays as written.

- [ ] **Step 9: Verify the whole thing**

Run: `npm --prefix web test`
Expected: PASS — 51 files.

Run: `npm --prefix web run lint`
Expected: no errors.

Run: `npm --prefix web run build`
Expected: build succeeds.

Then exercise the redirect for real. In `.env`, set `LOCAL_AUTHENTICATION_NEEDED=true`, run `./scripts/dev.sh`, and check:

- `http://localhost:3000/runs` with no session → lands on `/signin?callbackUrl=%2Fruns`, showing the page, with no navigation bar.
- The button starts the Google exchange, and signing in with an allowed address returns you to `/runs`, not to `/`.
- Signing in with an address outside `ALLOWED_EMAILS` / `ALLOWED_DOMAINS` returns to `/signin?error=AccessDenied`, showing `That address does not open the application.` above the button — and no Auth.js card anywhere.

Restore `LOCAL_AUTHENTICATION_NEEDED=false` in `.env` afterwards. `.env` is not tracked; confirm with `git status` that it does not appear.

- [ ] **Step 10: Commit**

```bash
git add web/auth.ts web/proxy.ts web/lib/public-paths.ts web/lib/public-paths.test.mts web/app/mcp/authorize/route.ts
git commit -F - <<'MSG'
feat: the front door is ours, refusal included

`pages.error` alongside `pages.signIn`, because AccessDenied is not a
SignInError and would otherwise keep landing on the built-in card — the
one screen an outsider ever sees.

The proxy now carries the requested path across, so a bookmark to a run
comes back to that run instead of the home page.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_019STYMJXFZWWzCpBrJmkwSG
MSG
```

---

## Out of scope, on purpose

- **The favicon.** `app/icon.svg` and `app/favicon.ico` stay exactly as they are. An inverted variant was rendered and compared against the current badge, and the current one was kept. Do not "improve" it in passing.
- **The French comments.** Every file in this plan carries some. They stay, verbatim, including where a sentence becomes slightly incomplete — `AppNav`'s docstring says the bar is *« absente de /shared »* and will now also be absent from `/signin`. A separate change, in its own commit, handles the translation.
- **`/api/auth/signin`.** It keeps existing and keeps working: with `pages.signIn` set, `@auth/core` redirects it onward to `/signin` and preserves `callbackUrl` (`@auth/core/lib/pages/index.js`). Nothing needs to delete or block it.
