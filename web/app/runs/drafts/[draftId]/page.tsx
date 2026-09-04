// Un run soumis par un agent, pas encore lancé.
//
// Cette adresse est celle que l'outil MCP rend à l'agent, donc elle doit
// continuer de répondre — mais elle ne montre plus un écran à part. Un
// brouillon n'est rien d'autre qu'un run qu'on n'a pas encore lancé : ce
// qu'on veut en faire, c'est le relire, le corriger, puis le lancer, ce que
// le formulaire d'évaluation fait déjà. Une page en lecture seule doublait
// cette interface en moins bien, et obligeait à lancer sans pouvoir toucher
// à quoi que ce soit.
//
// L'existence est vérifiée ici plutôt qu'après la redirection : un brouillon
// inconnu doit rendre 404 sur cette adresse, pas ouvrir un formulaire vide
// avec un message d'erreur.
import { notFound, redirect } from "next/navigation";
import { DraftNotFound, loadDraft } from "@/lib/drafts";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  try {
    await loadDraft(draftId);
  } catch (error) {
    if (error instanceof DraftNotFound) notFound();
    throw error;
  }

  redirect(`/?draft=${draftId}`);
}
