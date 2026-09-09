// A run's logs, relayed from Supabase Storage.
//
// The viewer reads an `.eval` — a ZIP — through `Range` requests: it takes the
// index, then the entry it wants, and never downloads the whole file. This route
// therefore forwards `Range` and returns the 206 as it stands. It does not read
// the body: recomposing it here would cost the server's memory on files it has
// no reason to open.
//
// The bucket being private, this is the only path to those bytes — and that is
// why the access control is in the front line.
import { isRunId } from "@/lib/run-id";
import { canReadRun } from "@/lib/run-access";
import { fetchRunLog } from "@/lib/storage";
import { isSafeLogName } from "@/lib/inspect-view";

/** The headers that make a ranged read work. */
const RELAYED = [
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

  const upstream = await fetchRunLog(runId, name, request.headers.get("range"));
  if (!upstream.ok && upstream.status !== 206) {
    // A run with no log is a normal case — nothing to tell apart from an unknown
    // run, and the viewer knows how to show an empty folder.
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  for (const name of RELAYED) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // `no-transform` forbids an intermediary from re-encoding the body. Without
  // it, Vercel compresses the response in brotli as soon as the browser accepts
  // it — which curl does not do by default, hence a flaw invisible on the command
  // line — and **then removes `Content-Length`**. The viewer, which needs the
  // ZIP's size to know where to read its index, stops on "Could not determine
  // content length". The `Range` requests escaped it, Vercel not compressing a
  // 206: only the very first read fell over, so the viewer never opened.
  //
  // An `.eval` is a ZIP: recompressing it gains nothing anyway.
  //
  // `no-transform` alone is not enough — Vercel does not honour it. Declaring the
  // body's encoding is: an intermediary that already sees a `Content-Encoding`
  // does not re-encode it. Both are laid down, the second because it works, the
  // first because it states the intent to whoever reads the code or puts a cache
  // in front.
  headers.set("Cache-Control", "private, no-store, no-transform");
  headers.set("Content-Encoding", "identity");

  return new Response(upstream.body, { status: upstream.status, headers });
}
