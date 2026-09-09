"use server";

import { signOut } from "@/auth";

/** Fermer la session, depuis un composant client.
 *
 * NextAuth's `signOut` can only be called on the server, and the
 * navigation est un composant client — une action serveur est le pont. Écrire
 * doing the `POST` to `/api/auth/signout` by hand would mean fetching the CSRF
 * token NextAuth demands; these three lines avoid it.
 *
 * `redirectTo` is `/` rather than the sign-in screen: once the cookie is gone,
 * the proxy sends you there itself. One place therefore knows where a
 * visiteur sans session. */
export async function logout() {
  await signOut({ redirectTo: "/" });
}
