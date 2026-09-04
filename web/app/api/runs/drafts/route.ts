import { NextResponse } from "next/server";
import { requireUser } from "@/auth";
import { createDraft, loadDrafts } from "@/lib/drafts";
import type { EvalRunConfig } from "@/lib/types";

/** Les brouillons en attente, de qui que ce soit.
 *
 * Un brouillon est une proposition faite à l'équipe : le filtrer par auteur
 * cacherait à celui qui peut le lancer ce qu'un agent vient de lui soumettre.
 *
 * `?launched=1` rouvre la liste à ceux qui ont déjà servi : ils gardent leur
 * adresse, et relancer la même chose est prévu. Hors de la liste par défaut,
 * qui est celle de ce qui attend. */
export async function GET(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const withLaunched = new URL(request.url).searchParams.get("launched") === "1";
  return NextResponse.json(await loadDrafts({ withLaunched }));
}

/** Enregistrer le formulaire en l'état, valide ou non.
 *
 * Aucune validation, et c'est le point : `submit_draft_run` en impose une
 * parce qu'un agent doit rendre quelque chose de lançable, mais un humain qui
 * s'arrête au milieu note où il en est. Exiger une configuration complète pour
 * avoir le droit de la mettre de côté rendrait le geste inutile — c'est
 * précisément quand il manque des morceaux qu'on veut y revenir.
 *
 * Ce qui protège du coup : rien ne lance un brouillon tout seul. Le lancement
 * repasse par le formulaire, qui refuse ce qui ne tient pas debout. */
export async function POST(request: Request) {
  const user = await requireUser();
  if ("response" in user) return user.response;

  const body = (await request.json().catch(() => null)) as {
    config?: unknown;
    csv_text?: unknown;
  } | null;
  if (!body || typeof body.config !== "object" || body.config === null) {
    return NextResponse.json({ error: "config must be an object" }, { status: 422 });
  }

  // La seule chose exigée d'un brouillon manuel. Tout le reste a le droit de
  // manquer — c'est sa raison d'être — mais sans nom, la liste d'attente
  // n'affiche que des « Untitled run » qu'on ne peut plus distinguer, et le
  // brouillon devient inutilisable pour celui-là même qui l'a écrit.
  const label = (body.config as EvalRunConfig).label;
  if (typeof label !== "string" || label.trim() === "") {
    return NextResponse.json(
      { error: "a draft needs a name — everything else can wait" },
      { status: 422 },
    );
  }

  const csvText = typeof body.csv_text === "string" ? body.csv_text : null;
  const id = await createDraft(
    body.config as EvalRunConfig,
    csvText,
    user.email,
    "manual",
  );
  return NextResponse.json({ id }, { status: 201 });
}
