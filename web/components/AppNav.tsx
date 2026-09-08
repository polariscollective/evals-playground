"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { getMe } from "@/lib/api";
import { logout } from "@/lib/auth-actions";
import { isOpen } from "@/lib/public-paths";
import { ensureRunsLoaded } from "@/lib/runs-store";
import { ensureTagsLoaded } from "@/lib/tags-store";
import { ensureProfileLoaded } from "@/lib/profile-store";
import { ensureConnectionsLoaded } from "@/lib/connections-store";
import { PolarisStar } from "@/components/PolarisStar";

/** La barre de l'application privée, absente de `/shared`.
 *
 * « La publication ouvre un run, pas l'application » — un inconnu qui arrive
 * sur un run publié ne doit pas voir un menu vers des pages qui exigent une
 * session, ni sous quelle adresse quelqu'un d'autre est connecté.
 *
 * Un composant client plutôt qu'un groupe de routes : le second aurait
 * déplacé `layout.tsx` et tout ce qui en dépend pour un menu de quatre liens.
 * Le préfixe se lit ici, une fois, et le proxy reste la seule autre source de
 * vérité sur ce qui est public — voir `lib/public-paths.ts`. */

const LINKS = [
  { href: "/", label: "Evaluate" },
  { href: "/runs", label: "Runs" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/settings/connections", label: "Connections" },
];

/** À quel onglet appartient la page ouverte.
 *
 * `/eval/<id>` est la page d'un run : elle n'a pas d'entrée à elle, mais on y
 * arrive depuis « Runs » et on y revient. L'onglet reste allumé plutôt que de
 * laisser la barre sans repère. */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/runs") return pathname.startsWith("/runs") || pathname.startsWith("/eval");
  return pathname.startsWith(href);
}

/** Where the bar does not belong.
 *
 * `/signin` joins `/shared`: four links to pages that need the very session
 * you are trying to obtain are worse than no bar at all.
 *
 * Not `isOpen` from `public-paths.ts`, which answers a different question —
 * `/prompt` and `/validate` are open paths that do want the bar. */
const HIDDEN_ON = ["/shared", "/signin"];

export function AppNav() {
  const pathname = usePathname();
  const hidden = HIDDEN_ON.some((prefix) => pathname.startsWith(prefix));
  const [email, setEmail] = useState<string | null>(null);

  /** Ce que les autres pages afficheront, chargé pendant qu'on lit celle-ci.
   *
   * Ici et non sur la page d'accueil : elle était le seul endroit à le faire,
   * si bien qu'arriver directement sur « Scenarios » — par un lien, un
   * signet, un rechargement — laissait tous les autres onglets froids. La
   * barre, elle, est rendue par `layout.tsx` sur chaque page.
   *
   * Chaque `ensure*` ne demande rien si la ressource a déjà servi : passer de
   * page en page ne relance donc pas quatre requêtes à chaque fois.
   *
   * `isOpen` et non `hidden` : ce dernier ne connaît que `/shared`, alors que
   * la question posée ici est plus large — « ce chemin se lit-il sans
   * session ? ». Précharger sur une page publique enverrait quatre requêtes
   * privées au nom d'un inconnu, qui les verrait toutes échouer. La réponse
   * vit dans `public-paths.ts`, avec le proxy qui l'applique ; la dupliquer
   * ici la laisserait dériver. */
  const publique = isOpen(pathname);
  useEffect(() => {
    if (publique) return;
    ensureRunsLoaded();
    ensureTagsLoaded();
    ensureProfileLoaded();
    ensureConnectionsLoaded();
  }, [publique]);

  useEffect(() => {
    // Le crochet doit être appelé même sur `/shared`, où la barre ne s'affiche
    // pas — d'où la condition ici plutôt qu'un retour anticipé au-dessus.
    if (hidden) return;
    getMe()
      .then(({ email }) => setEmail(email))
      .catch(() => setEmail(null));
  }, [hidden]);

  if (hidden) return null;

  return (
    // `bg-background` n'est pas décoratif : une barre collante sans fond opaque
    // laisse défiler le formulaire par-dessous. Et `z-40` la met au-dessus du
    // contenu sans passer devant les modales, qui sont en `z-50`.
    <nav className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-background px-8 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* L'étoile et le nom du collectif, repris de l'en-tête de
            polariscollective.org — même tracé, même olive, même serif. Ce n'est
            pas un lien : l'application n'a pas de page d'accueil qui soit
            ailleurs que « Evaluate », et un logo qui mène au premier onglet
            donne deux chemins vers la même chose. */}
        <span className="flex items-center gap-2 font-serif text-base text-teal-700">
          <PolarisStar />
          Polaris Collective
        </span>
        <span aria-hidden="true" className="h-4 w-px bg-zinc-300" />
        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent(pathname, href) ? "page" : undefined}
            className={
              isCurrent(pathname, href)
                ? "font-medium text-teal-700"
                : "font-medium text-zinc-500 hover:text-zinc-900"
            }
          >
            {label}
          </Link>
        ))}
      </div>
      {/* Tant que l'adresse n'est pas connue, rien : un bouton de déconnexion
          sans savoir qui est connecté ne dit rien de vrai. */}
      {email && (
        <div className="flex items-center gap-3">
          <span className="text-zinc-500">Logged in as</span>
          <Link href="/profile" className="font-medium hover:underline">
            {email}
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded border px-3 py-1 hover:bg-zinc-100"
            >
              Log out
            </button>
          </form>
        </div>
      )}
    </nav>
  );
}
