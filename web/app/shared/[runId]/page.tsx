// Un run publié, pour qui a l'adresse.
//
// Ce fichier ne fait que charger : il valide la forme de l'adresse, refuse un
// run qui n'est pas publié, et passe la main à `SharedRunView`, qui rend
// exactement ce que la page privée rend — matrice ouvrable, scénarios,
// trajectoires. La lecture publique n'a jamais eu de raison d'être plus
// pauvre que la privée.
//
// Ce qui la tient : `loadPublicRun` refuse un run non publié et retire
// l'adresse de qui l'a lancé, `requireUser()` garde toutes les routes qui
// écrivent, et le type `PublicRunDetail` interdit au compilateur d'afficher
// l'auteur. Le proxy, lui, ne fait qu'aiguiller — il ne prouve rien.
import { notFound } from "next/navigation";
import { NotFound, loadPublicRun } from "@/lib/runs";
import { isRunId } from "@/lib/run-id";
import { SharedRunView } from "@/components/SharedRunView";

export default async function SharedRun({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  if (!isRunId(runId)) notFound();

  // Le chargement seul dans le `try` : `notFound()` lève pour signaler à Next
  // qu'il doit rendre la page 404, et construire le JSX ici ferait attraper ce
  // signal par le `catch`.
  let detail;
  try {
    // Les trajectoires d'un coup : la fenêtre de détail les lit depuis ce qui
    // est déjà chargé, faute d'une route publique à interroger au clic.
    detail = await loadPublicRun(runId, { withTranscripts: true });
  } catch (error) {
    if (error instanceof NotFound) notFound();
    throw error;
  }

  return <SharedRunView detail={detail} />;
}
