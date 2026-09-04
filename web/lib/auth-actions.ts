"use server";

import { signOut } from "@/auth";

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
