import { agentModels, runFormat } from "@/lib/run-format";
import { DEFAULT_FAVORITE_MODELS } from "@/lib/favorite-models";

/** The public address under which we were called.
 *
 * The prompt sends the agent there to check its document, and a relative address
 * would serve it only if it had itself read this page. Behind Vercel's proxy,
 * `request.url` carries the internal host: it is the forwarded headers that say
 * under what name we are reachable. Locally there are none, and the request's
 * URL is enough. */
function originOf(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** The prompt that helps write a run, in plain text and with no sign-in.
 *
 * Deliberately outside the door: the point is to give this URL to an agent,
 * which has no session and would not know how to get one. What it returns holds
 * nothing private — a fixed text, plus the list of default models, which comes
 * from `shared/pricing.json`, a file of this public repository.
 *
 * The default, and never anybody's favourites: with no session one does not know
 * who is asking, so nothing depending on who is asking can come out here — the
 * same rule as `/advice.txt`, which serves the default advice for that
 * exact reason. The agent going through MCP, for its part, is identified, and
 * `read_format` returns its own list.
 *
 * In `text/plain` because the reader is a machine: HTML would make it cross a
 * layout to find the text meant for it. */
export async function GET(request: Request) {
  return new Response(
    runFormat(agentModels(DEFAULT_FAVORITE_MODELS), originOf(request)),
    {
      headers: {
        "content-type": "text/plain; charset=utf-8",
          // The content only moves with a deployment: five minutes of cache save
          // as many cold starts without ever serving anything stale.
        "cache-control": "public, max-age=300",
      },
    },
  );
}
