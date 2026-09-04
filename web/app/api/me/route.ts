import { NextResponse } from "next/server";
import { requireUser } from "@/auth";

/** Qui regarde.
 *
 * Le navigateur ne l'a jamais su : rien ne l'exigeait tant que tout le monde
 * voyait tout sans distinction. Filtrer « les miens » demande de comparer une
 * adresse à celles que portent déjà les runs et les brouillons — d'où cette
 * route, et rien de plus qu'elle. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  return NextResponse.json({ email: user.email });
}
