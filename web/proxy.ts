import { NextResponse, type NextRequest } from "next/server";

// Ce fichier ne fait **pas** d'authentification. Il aiguille.
//
// Nommé `proxy.ts` et non `middleware.ts` : Next 16 a renommé la convention, et
// le repli de compatibilité qui fonctionne en développement ne suffit pas au
// déploiement — un `middleware.ts` y produisait un MIDDLEWARE_INVOCATION_FAILED
// sans autre explication. L'export doit s'appeler `proxy`, et il est nommé,
// pas par défaut.
//
// La version précédente appelait `auth()` de NextAuth ici, donc faisait tourner
// toute la bibliothèque sur le runtime edge. C'est ce qui a produit un
// MIDDLEWARE_INVOCATION_FAILED opaque au premier déploiement : quand ce
// code-là échoue, la plateforme rend une erreur 500 sans rien dire de ce qui
// manquait.
//
// La vraie vérification vit maintenant dans les routes, avec `requireUser()` —
// côté serveur Node, avec une session réellement validée. Ici on se contente de
// regarder si un cookie de session existe, pour envoyer un visiteur anonyme
// vers l'écran de connexion plutôt que de le laisser buter sur un 401. Un
// cookie forgé passerait cette porte-ci ; il ne passerait aucune route.

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

/** Le court-circuit de développement, verrouillé sur `NODE_ENV`.
 *
 * Les mêmes deux conditions que `getSessionEmail` dans auth.ts, pour que
 * l'application n'ait qu'un seul interrupteur plutôt que deux armés
 * indépendamment. */
const skipAuthInDev =
  process.env.NODE_ENV !== "production" &&
  process.env.LOCAL_AUTHENTICATION_NEEDED === "false";

export function proxy(request: NextRequest) {
  if (skipAuthInDev) return NextResponse.next();

  const signedIn = SESSION_COOKIES.some(
    (name) => request.cookies.get(name)?.value,
  );
  if (signedIn) return NextResponse.next();

  // Une route d'API répond 401 ; une page part vers l'écran de connexion.
  // Renvoyer une page de connexion à un `fetch` produirait du HTML là où le
  // code attend du JSON, et l'erreur serait illisible.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/api/auth/signin", request.nextUrl.origin));
}

// Ce littéral doit rester égal à ce que rend `proxyMatcher()` dans
// `lib/public-paths.ts` : Next exige une constante ici et ignore une valeur
// calculée. `public-paths.test.mts` tient l'accord des deux.
export const config = {
  matcher: [
    "/((?!api/auth(?:/|$)|prompt(?:/|$)|validate(?:/|$)|shared(?:/|$)|inspect-view(?:/|$)|mcp(?:/|$)|\\.well-known(?:/|$)|_next/static(?:/|$)|_next/image(?:/|$)|favicon\\.ico$).*)",
  ],
};
