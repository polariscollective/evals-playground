import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { ConfigFileError, readConfigFile } from "@/lib/config-file";

/** Lit un run décrit dans un fichier JSON ou YAML, et le rend prêt à remplir le
 * formulaire.
 *
 * Côté serveur pour deux raisons : l'analyseur YAML reste hors du paquet envoyé
 * au navigateur, et la validation qui s'applique ici est exactement celle du
 * lancement — un fichier accepté ici ne peut pas être refusé au moment de
 * lancer. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    text?: string;
  } | null;

  if (typeof body?.text !== "string" || body.text.trim() === "") {
    return NextResponse.json({ error: "The file is empty." }, { status: 422 });
  }

  try {
    return NextResponse.json(readConfigFile(body.text));
  } catch (error) {
    if (error instanceof ConfigFileError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
