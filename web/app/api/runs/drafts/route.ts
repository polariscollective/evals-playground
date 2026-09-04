import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { loadDrafts } from "@/lib/drafts";

/** Les brouillons en attente, de qui que ce soit.
 *
 * Un brouillon est une proposition faite à l'équipe : le filtrer par auteur
 * cacherait à celui qui peut le lancer ce qu'un agent vient de lui soumettre. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  return NextResponse.json(await loadDrafts());
}
