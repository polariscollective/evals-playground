import { NextResponse } from "next/server";
import { auth } from "./auth";

// Développement seulement : rend l'application joignable sans dérouler un
// échange OAuth. Verrouillé sur les deux mêmes conditions que `getSessionEmail`
// dans auth.ts, pour que l'application n'ait qu'un seul interrupteur plutôt que
// deux armés indépendamment — et ce middleware est la seule vérification de
// session que voient les routes qui déclenchent un run, lesquelles dépensent
// l'argent de l'organisation.
const skipAuthInDev =
  process.env.NODE_ENV !== "production" &&
  process.env.LOCAL_AUTHENTICATION_NEEDED === "false";

export default auth((request) => {
  if (skipAuthInDev) return NextResponse.next();
  if (request.auth) return NextResponse.next();

  // Une route d'API répond 401 ; une page part vers l'écran de connexion.
  // Renvoyer une page de connexion à un appel `fetch` produirait du HTML là où
  // le code attend du JSON, et l'erreur serait illisible.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/api/auth/signin", request.nextUrl.origin));
});

// Quatre exclusions ne passent pas du tout par le middleware ; tout le reste
// atteint la fonction ci-dessus, qui décide. Chacune est ancrée par
// `(?:/|$)` — répertoire ou fin exacte — sauf `favicon.ico$`, un fichier unique.
// Sans ancrage, un simple préfixe laisserait passer un chemin voisin plus long :
// `/api/authx`, `/_next/imagex` et `/_next/staticfoo` contourneraient la porte.
//
// `api/auth` est exclu ici, au niveau du filtre, plutôt que laissé à la
// fonction : le wrapper `auth()` résout la session avant même d'appeler notre
// code et ajoute son `Set-Cookie` à la réponse quoi qu'il arrive. Sur
// `/api/auth/signout` ou `/api/auth/callback/*`, ce cookie parasite entrerait en
// concurrence avec celui que pose NextAuth pour la même requête — une course
// sur le chemin critique de la connexion.
export const config = {
  matcher: [
    "/((?!api/auth(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)",
  ],
};
