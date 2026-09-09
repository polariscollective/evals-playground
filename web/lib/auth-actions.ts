"use server";

import { signOut } from "@/auth";

/** Closing the session, from a client component.
 *
 * NextAuth's `signOut` can only be called on the server, and the navigation is
 * a client component — a server action is the bridge. Doing the `POST` to
 * `/api/auth/signout` by hand would mean fetching the CSRF token NextAuth
 * demands; these three lines avoid it.
 *
 * `redirectTo` is `/` rather than the sign-in screen: once the cookie is gone,
 * the proxy sends you there itself. One place therefore knows where a visitor
 * with no session lands. */
export async function logout() {
  await signOut({ redirectTo: "/" });
}
