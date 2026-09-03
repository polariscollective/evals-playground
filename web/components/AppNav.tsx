"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

/** La barre de l'application privée, absente de `/shared`.
 *
 * « La publication ouvre un run, pas l'application » — un inconnu qui arrive
 * sur un run publié ne doit pas voir un menu vers des pages qui exigent une
 * session, ou qui n'existent pas encore.
 *
 * Un composant client plutôt qu'un groupe de routes : le second aurait
 * déplacé `layout.tsx` et tout ce qui en dépend pour un menu de six liens. Le
 * préfixe se lit ici, une fois, et le proxy reste la seule autre source de
 * vérité sur ce qui est public — voir `lib/public-paths.ts`. */
export function AppNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/shared")) return null;

  return (
    <nav className="border-b px-8 py-3 flex gap-6 text-sm">
      <Link href="/" className="font-medium">
        Evaluate
      </Link>
      <Link href="/runs" className="font-medium">
        Runs
      </Link>
      <Link href="/creer" className="font-medium">
        Create
      </Link>
      <Link href="/scenarios" className="font-medium">
        Scenarios
      </Link>
      <Link href="/juges" className="font-medium">
        Judges
      </Link>
    </nav>
  );
}
