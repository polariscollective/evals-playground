import { DEFAULT_SCENARIO_ADVICE } from "@/lib/scenario-advice";

/** The scenario writing advice, in plain text and with no sign-in.
 *
 * The counterpart of `/prompt`, outside the door for the same reason: the point
 * is to give this address to an agent that has no session and would not know how
 * to get one. `{{ORIGIN}}/scenarios` — the page that shows this same text for a
 * human to copy — did not suit that use: it demands a session, and its content
 * only arrives afterwards, through a client call, never in the initial HTML an
 * agent with no browser would read.
 *
 * Always serves `DEFAULT_SCENARIO_ADVICE`, never a profile's override. With no
 * session, one does not know who is asking — returning to a stranger the version
 * a person rewrote for their own agents would be leaking them a text written in
 * private. The MCP tool `read_scenario_advice`, for its part, is authenticated:
 * it knows the caller and keeps returning their own version. That is the whole
 * difference between the two doors.
 *
 * In `text/plain` because the reader is a machine: HTML would make it cross a
 * layout to find the text meant for it. */
export async function GET() {
  return new Response(DEFAULT_SCENARIO_ADVICE, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
        // The content only moves with a deployment: five minutes of cache save as
        // many cold starts without ever serving anything stale.
      "cache-control": "public, max-age=300",
    },
  });
}
