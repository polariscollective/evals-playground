import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import {
  ConfigFileError,
  readConfigFile,
  writeConfigFile,
} from "@/lib/config-file";
import type { EvalRunConfig } from "@/lib/types";

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

/** Le chemin inverse : la configuration du formulaire, écrite en YAML.
 *
 * Ici plutôt que dans la page pour deux raisons : l'écrivain YAML reste hors du
 * paquet du navigateur, et les deux sens de la même conversion vivent côte à
 * côte — c'est ce qui rend visible qu'ils doivent rester d'accord. */
export async function PUT(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    config?: EvalRunConfig;
  } | null;

  if (!body?.config) {
    return NextResponse.json({ error: "config is missing." }, { status: 422 });
  }

  return NextResponse.json({ text: writeConfigFile(body.config) });
}
