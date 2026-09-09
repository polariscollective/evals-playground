// Telling an agent whether its document would pass, before it hands it over.
//
// The counterpart of `/format.txt`, and outside the door for the same reason: both
// address a machine that has no session and would not know how to get one. What
// it returns holds nothing private — a verdict on a text the caller already
// owns, pronounced according to rules published in plain sight on `/format.txt`. No
// run, no note, no address passes through it, and nothing enters it: the route
// does not read the database.
//
// What it changes is where a mistake is paid for. Without it: the agent returns
// a document, one pastes it, it is refused, one goes back to it. With it, the
// correction happens inside its own loop, and what one receives loads.
import { costSentence } from "@/lib/pricing";
import { verdictOf } from "@/lib/verdict";

/** The verdict itself lives in `lib/`, where the tests see it. Here, the
 *  transport and nothing else.
 *
 * In `text/plain` because the reader is a machine, and because the refusal
 * message is already a sentence — the very one the paste window shows. */
function say(status: number, message: string): Response {
  return new Response(message + "\n", {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
        // A verdict bears on this request's text: caching it would make no sense,
        // and serving a stale one would be worse than nothing.
      "cache-control": "no-store",
    },
  });
}

function verdict(text: string): Response {
  const { status, message } = verdictOf(text, costSentence);
  return say(status, message);
}

/** For the agent that knows how to POST: the document as a raw body, with no
 *  encoding and no URL length to work around. */
export async function POST(request: Request) {
  return verdict(await request.text());
}

/** For the agent that can only read an address.
 *
 * The document travels in the query string, which imposes a far lower cap on it
 * than the POST: Node cuts at 16 KB, request line included, and URL encoding
 * swells a YAML by half. Thirty scenarios written out in full do not fit — and
 * do not have to, since the check that counts bears on the shape, which does not
 * depend on their number. The prompt says so: sending two or three scenarios is
 * enough. */
export async function GET(request: Request) {
  const yaml = new URL(request.url).searchParams.get("yaml");
  if (yaml === null) {
    return say(
      400,
      "Pass the document as ?yaml=<url-encoded>, or POST it as the body.",
    );
  }
  return verdict(yaml);
}
