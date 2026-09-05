// Le viewer d'Inspect, servi sur le dossier de journaux d'un run.
//
// La coquille est statique — `web/public/inspect-view/`, posée par
// `scripts/build-inspect-view.sh` — et cette route ne fait que la retoucher :
// les assets en absolu, et le dossier de journaux injecté. C'est exactement ce
// que fait `inspect view bundle`, à ceci près que les journaux ne sont pas dans
// un dossier voisin mais derrière la route d'à côté.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isRunId } from "@/lib/run-id";
import { canReadRun } from "@/lib/run-access";
import { logDirUri, originOf, viewerHtml } from "@/lib/inspect-view";

const DIST = path.join(process.cwd(), "public", "inspect-view", "index.html");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  if (!isRunId(runId)) return new Response("Not found", { status: 404 });
  if (!(await canReadRun(runId))) {
    return new Response("Not found", { status: 404 });
  }

  let dist: string;
  try {
    dist = await readFile(DIST, "utf8");
  } catch {
    // Le viewer n'a jamais été posé : `scripts/build-inspect-view.sh`.
    return new Response("Inspect viewer is not installed.", { status: 500 });
  }

  const html = viewerHtml(dist, {
    assetsBase: "/inspect-view/assets",
    // L'origine vient des en-têtes, pas de `request.url` : voir `originOf`.
    // Se tromper d'origine rend le dossier de journaux cross-origin, et le
    // viewer n'affiche plus qu'un « Failed to fetch ».
    logDir: logDirUri(
      originOf(request.headers, new URL(request.url).origin),
      runId,
    ),
  });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Le document porte l'identifiant du run et l'origine : rien à mettre en
      // cache partagé, et le contrôle d'accès doit être refait à chaque fois.
      "Cache-Control": "private, no-store",
    },
  });
}
