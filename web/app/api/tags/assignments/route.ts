import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { tagsByDraft, tagsByRun } from "@/lib/tags";

/** Les tags de tous les runs et de tous les brouillons, en un seul aller-retour.
 *
 * La liste des runs affiche une pastille par tag sur chacune de ses lignes —
 * parfois des dizaines — et un appel par ligne serait absurde là où
 * `tagsByRun`/`tagsByDraft` ramènent déjà tout en une lecture. Un `Map` ne
 * survit pas au JSON : on le rend en objet ordinaire. */
export async function GET() {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const [runs, drafts] = await Promise.all([tagsByRun(), tagsByDraft()]);
  return NextResponse.json({
    runs: Object.fromEntries(runs),
    drafts: Object.fromEntries(drafts),
  });
}
