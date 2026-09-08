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

      <h1 className="flex items-center gap-3 font-serif text-2xl font-normal text-teal-700">
        <PolarisStar size={22} />
        Polaris Collective
      </h1>

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
