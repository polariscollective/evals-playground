import { ADVICE_TOPICS, DEFAULT_ADVICE, isAdviceTopic } from "@/lib/advice";

/** Un document de conseil, en texte brut et sans connexion.
 *
 * The counterpart of `/prompt`, outside the door for the same reason: the
 * point is to give this address to an agent that has no session and would not
 * know how to obtain one. `{{ORIGIN}}/scenarios` — the page showing these same
 * texts for a human to copy — did not suit that use: it requires a session, and
 * its content only arrives afterwards, through a client call, never in the
 * initial HTML an agent without a browser would read.
 *
 * `?topic=` picks which of the four. Absent returns the scenario one: that is
 * the address from before the advice was split in four, and it is written into
 * prompts that have already gone out.
 *
 * Always serves the default, never a profile's override. Without a session we
 * do not know who is asking — handing a stranger the version somebody rewrote
 * for their own agents would leak a text written in private. The MCP tool
 * `read_advice` is authenticated: it knows the caller and keeps returning their
 * own version. That is the whole difference between the two doors.
 *
 * `text/plain` because the reader is a machine: HTML would make it walk through
 * a layout to find the text meant for it. */
export async function GET(request: Request) {
  const asked = new URL(request.url).searchParams.get("topic");
  // An unreadable topic falls back to the scenario one rather than returning a
  // 404: the caller is an agent, and a useful document beats an error it will
  // not know how to fix. The names of all four are in the message.
  const topic = isAdviceTopic(asked) ? asked : "scenario";
  const header =
    asked !== null && !isAdviceTopic(asked)
      ? `[No document named "${asked}". The four are: ${ADVICE_TOPICS.join(", ")}. ` +
        "Serving the scenario one.]\n\n"
      : "";

  return new Response(header + DEFAULT_ADVICE[topic], {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // The content only moves with a deployment: five minutes of cache save as
      // many cold starts without ever serving something stale.
      "cache-control": "public, max-age=300",
    },
  });
}
