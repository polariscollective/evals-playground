"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";

/** Fermer la session, depuis un composant client.
 *
 * `signOut` de NextAuth ne s'appelle que côté serveur, et la barre de
 * navigation est un composant client — une action serveur est le pont. Écrire
 * le `POST` vers `/api/auth/signout` à la main obligerait à aller chercher le
 * jeton CSRF que NextAuth exige ; ces trois lignes l'évitent.
 *
 * `redirectTo` vaut `/` plutôt que l'écran de connexion : une fois le cookie
 * parti, le proxy y renvoie de lui-même. Un seul endroit sait donc où va un
 * visiteur sans session. */
export async function logout() {
  await signOut({ redirectTo: "/" });
}

/** Start the Google exchange, and come back where the visitor was heading.
 *
 * `signIn` runs on the server only — the same constraint that put `logout`
 * here rather than in the bar.
 *
 * `callbackUrl` arrives through a hidden input because a server action does
 * not see the request that rendered the page. It cannot become an open
 * redirect: Auth.js runs every `redirectTo` through its `redirect` callback,
 * and the default (`@auth/core/lib/init.js`) prefixes a bare path with the
 * base URL and answers `baseUrl` for any other origin.
 *
 * The catch is not decoration. `next-auth` calls `@auth/core` in raw mode, and
 * `@auth/core` rethrows an `AuthError` at the caller instead of rendering
 * anything — so a bad moment at Google's discovery endpoint would surface as
 * Next's own opaque server-action error page. That is the screen belonging to
 * someone else that this page exists to stop showing. Sending it back here
 * lets `signInMessage` say something true about it instead.
 *
 * The rethrow is what makes the success path work: `signIn` signals its
 * redirect by throwing `NEXT_REDIRECT`, which is not an `AuthError` and must
 * travel on untouched. */
export async function login(formData: FormData) {
  const callbackUrl = formData.get("callbackUrl");
  const redirectTo =
    typeof callbackUrl === "string" && callbackUrl ? callbackUrl : "/";
  try {
    await signIn("google", { redirectTo });
  } catch (error) {
    if (error instanceof AuthError) {
      redirect(`/signin?error=${encodeURIComponent(error.type)}`);
    }
    throw error;
  }
}
