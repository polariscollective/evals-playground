import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "./lib/allowed-email";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  callbacks: {
    // Le seul contrôle d'accès de l'application : se connecter avec Google ne
    // suffit pas, il faut être sur la liste. Refuser ici plutôt qu'après coup
    // évite qu'une session existe pour quelqu'un qui n'a rien à faire là.
    async signIn({ user }) {
      return isAllowedEmail(user.email);
    },
  },
});

/** L'adresse de la session, ou null si personne n'est connecté.
 *
 * En développement, `LOCAL_AUTHENTICATION_NEEDED=false` fait passer chaque
 * requête pour `LOCAL_AUTHENTICATION_EMAIL`, ce qui permet d'exercer les routes
 * sans dérouler un vrai échange OAuth. Verrouillé sur `NODE_ENV`, donc
 * inactivable sur un déploiement quelle que soit la valeur du drapeau. */
export async function getSessionEmail(): Promise<string | null> {
  if (
    process.env.NODE_ENV !== "production" &&
    process.env.LOCAL_AUTHENTICATION_NEEDED === "false"
  ) {
    return process.env.LOCAL_AUTHENTICATION_EMAIL || null;
  }
  const session = await auth();
  return session?.user?.email ?? null;
}
