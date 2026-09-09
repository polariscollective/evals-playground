// Inspect's viewer, served on a run's logs folder.
//
// The shell is static — `web/public/inspect-view/`, laid down by
// `scripts/build-inspect-view.sh` — and this route only retouches it: the assets
// made absolute, and the logs folder injected. It is exactly what
// `inspect view bundle` does, except that the logs are not in a neighbouring
// folder but behind the route next door.
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
    // The viewer was never laid down: `scripts/build-inspect-view.sh`.
    return new Response("Inspect viewer is not installed.", { status: 500 });
  }

  const html = viewerHtml(dist, {
    assetsBase: "/inspect-view/assets",
    // The origin comes from the headers, not from `request.url`: see `originOf`.
    // Getting the origin wrong makes the logs folder cross-origin, and the viewer
    // shows nothing but a "Failed to fetch".
    logDir: logDirUri(
      originOf(request.headers, new URL(request.url).origin),
      runId,
    ),
  });

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The document carries the run's identifier and the origin: nothing to put
      // in a shared cache, and the access control must be redone every time.
      "Cache-Control": "private, no-store",
    },
  });
}
