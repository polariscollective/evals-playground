"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { getMe } from "@/lib/api";
import { logout } from "@/lib/auth-actions";

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

export function AppNav() {
  const pathname = usePathname();
  const hidden = pathname.startsWith("/shared");
  const [email, setEmail] = useState<string | null>(null);

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
    <nav className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b px-8 py-3 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {LINKS.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={isCurrent(pathname, href) ? "page" : undefined}
            className={
              isCurrent(pathname, href)
                ? "font-medium"
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
