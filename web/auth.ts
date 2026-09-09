import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowedEmail } from "./lib/allowed-email";
import { ensureProfile } from "./lib/profiles";

/** What signing in cannot work without on a deployment.
 *
 * `ALLOWED_EMAILS` and `ALLOWED_DOMAINS` are not there: both empty is a valid
 * configuration, the one that lets nobody in. That is restrictive, and therefore
 * harmless — unlike a missing secret, which brings everything down. */
const REQUIRED_IN_PRODUCTION = [
  "AUTH_SECRET",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
] as const;

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Behind Vercel, a proxy or a tunnel, the host the application sees is not the
  // one it believes it serves. Without this, Auth.js refuses the request with
  // `UntrustedHost` — checked locally, where the error appeared on every session
  // read.
  trustHost: true,
  providers: [Google],
  callbacks: {
    // The application's only access control: signing in with Google is not
    // enough, one has to be on the list. Refusing here rather than afterwards
    // keeps a session from existing for somebody who has no business there.
    async signIn({ user }) {
      return isAllowedEmail(user.email);
    },
  },
});

/** This request's user, or a 401 response to return as it stands.
 *
 * The access control is here, and nowhere else. The middleware only looks at a
 * cookie, so as to route; by itself it proves nothing. Every route must go
 * through this function, without which it is open. */
export async function requireUser(): Promise<
  { email: string } | { response: Response }
> {
  // A variable forgotten on the deployment makes Auth.js throw, and the platform
  // then returns a 500 that says nothing. Naming what is missing costs three lines
  // and saves searching the logs of a service one has just plugged in.
  const missing = REQUIRED_IN_PRODUCTION.filter((name) => !process.env[name]);
  if (process.env.NODE_ENV === "production" && missing.length > 0) {
    return {
      response: Response.json(
        {
          error:
            `Sign-in is not configured: ${missing.join(", ")} ` +
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

  // At best: the door lays the profile down as soon as an identity presents
  // itself, as `callerEmail` does on the MCP side, so that it already exists when
  // a launch needs it. A miss here must not make a reading fail that has nothing
  // to do with the spending — only a launch refuses itself over that, see
  // `mcp-budget.ts` and its call in `app/mcp/route.ts`.
  try {
    await ensureProfile(email);
  } catch (error) {
    console.error(`Could not ensure a profile for ${email}:`, (error as Error).message);
  }

  return { email };
}

/** The session's address, or null if nobody is signed in.
 *
 * In development, `LOCAL_AUTHENTICATION_NEEDED=false` makes every request pass
 * for `LOCAL_AUTHENTICATION_EMAIL`, which lets one exercise the routes without
 * unrolling a real OAuth exchange. Locked on `NODE_ENV`, and therefore
 * impossible to turn on for a deployment whatever the flag's value. */
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
