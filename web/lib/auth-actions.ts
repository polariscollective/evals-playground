"use server";

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
 * base URL and answers `baseUrl` for any other origin. */
export async function login(formData: FormData) {
  const callbackUrl = formData.get("callbackUrl");
  await signIn("google", {
    redirectTo:
      typeof callbackUrl === "string" && callbackUrl ? callbackUrl : "/",
  });
}
