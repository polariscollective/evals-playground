// Les journaux d'un run, relayés depuis Supabase Storage.
//
// Le viewer lit un `.eval` — un ZIP — par requêtes `Range` : il prend le
// sommaire, puis l'entrée qui l'intéresse, et ne télécharge jamais le fichier
// entier. Cette route transmet donc `Range` et rend le 206 tel quel. Elle ne
// lit pas le corps : le recomposer ici coûterait la mémoire du serveur sur des
// fichiers qu'il n'a aucune raison d'ouvrir.
//
// Le bucket étant privé, c'est le seul chemin vers ces octets — et c'est
// pourquoi le contrôle d'accès est en première ligne.
import { isRunId } from "@/lib/run-id";
import { canReadRun } from "@/lib/run-access";
import { fetchRunLog } from "@/lib/storage";
import { isSafeLogName } from "@/lib/inspect-view";

/** Les en-têtes qui font qu'une lecture par tranches fonctionne. */
const RELAYÉS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
  "etag",
  "last-modified",
];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  const { runId, path } = await params;
  const name = path?.length === 1 ? path[0] : "";
  if (!isRunId(runId) || !isSafeLogName(name)) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await canReadRun(runId))) {
    return new Response("Not found", { status: 404 });
  }

  const amont = await fetchRunLog(runId, name, request.headers.get("range"));
  if (!amont.ok && amont.status !== 206) {
    // Un run sans journal est un cas normal — rien à distinguer d'un run
    // inconnu, et le viewer sait afficher un dossier vide.
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  for (const nom of RELAYÉS) {
    const valeur = amont.headers.get(nom);
    if (valeur) headers.set(nom, valeur);
  }
  // `no-transform` interdit à un intermédiaire de recoder le corps. Sans lui,
  // Vercel compresse la réponse en brotli dès que le navigateur l'accepte —
  // ce que curl ne fait pas par défaut, d'où un défaut invisible en ligne de
  // commande — et **retire alors `Content-Length`**. Le viewer, qui a besoin
  // de la taille du ZIP pour savoir où lire son sommaire, s'arrête sur
  // « Could not determine content length ». Les requêtes `Range` y
  // échappaient, Vercel ne compressant pas un 206 : seule la toute première
  // lecture tombait, donc le viewer ne s'ouvrait jamais.
  //
  // Un `.eval` est un ZIP : le recompresser ne gagne rien de toute façon.
  //
  // `no-transform` seul ne suffit pas — Vercel ne l'honore pas. Déclarer
  // l'encodage du corps, si : un intermédiaire qui voit déjà un
  // `Content-Encoding` ne le recode pas. Les deux sont posés, le second parce
  // qu'il marche, le premier parce qu'il dit l'intention à qui lit le code ou
  // met un cache devant.
  headers.set("Cache-Control", "private, no-store, no-transform");
  headers.set("Content-Encoding", "identity");

  return new Response(amont.body, { status: amont.status, headers });
}
