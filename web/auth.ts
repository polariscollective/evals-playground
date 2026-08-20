import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "./lib/allowed-email";

/** Ce sans quoi la connexion ne peut pas fonctionner en déploiement.
 *
 * `ALLOWED_EMAILS` et `ALLOWED_DOMAINS` n'y sont pas : les deux vides sont une
 * configuration valide, celle qui ne laisse entrer personne. C'est restrictif,
 * donc sans danger — au contraire d'un secret manquant, qui fait tout tomber. */
const REQUIRED_IN_PRODUCTION = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
] as const;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Derrière Vercel, un proxy ou un tunnel, l'hôte vu par l'application n'est
  // pas celui qu'elle croit servir. Sans ça, Auth.js refuse la requête avec
  // `UntrustedHost` — vérifié en local, où l'erreur apparaissait à chaque
  // lecture de session.
  trustHost: true,
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

/** L'utilisateur de cette requête, ou une réponse 401 à renvoyer tel quel.
 *
 * C'est ici qu'est le contrôle d'accès, et nulle part ailleurs. Le middleware
 * ne regarde qu'un cookie, pour aiguiller ; lui seul ne prouve rien. Chaque
 * route doit passer par cette fonction, sans quoi elle est ouverte. */
export async function requireUser(): Promise<
  { email: string } | { response: Response }
> {
  // Une variable oubliée au déploiement fait lever Auth.js, et la plateforme
  // rend alors un 500 qui ne dit rien. Nommer ce qui manque coûte trois lignes
  // et évite de chercher dans les journaux d'un service qu'on vient de brancher.
  const manquantes = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);
  if (process.env.NODE_ENV === "production" && manquantes.length > 0) {
    return {
      response: Response.json(
        {
          error:
            `Sign-in is not configured: ${manquantes.join(", ")} ` +
            "missing from the environment.",
        },
        { status: 503 },
      ),
    };
  }

  const email = await getSessionEmail();
  if (!email) {
    return {
      response: Response.json({ error: "not signed in" }, { status: 401 }),
    };
  }
  return { email };
}

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
