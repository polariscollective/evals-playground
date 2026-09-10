// Where a shared page sends somebody who signs in from it.
//
// One rule, written once: the internal counterpart of a shared address. The
// alternative is each page building its own string, which is fine until one of
// them is renamed and the other keeps pointing at the old name for a year
// without anybody noticing, because nothing signs in from that page very often.
//
// The query string travels. Somebody reading the judge document under
// `?topic=judge` and signing in from it should land on the judge document, not
// on the first tab.

/** The internal page a shared run is a read-only copy of. */
export function runReturn(runId: string): string {
  return `/eval/${runId}`;
}

/** The internal page the shared advice is a read-only copy of.
 *
 * `scenario` is the tab that opens when nothing is asked for, on both sides, so
 * carrying it would only write the default into the address bar. */
export function adviceReturn(topic: string): string {
  return topic && topic !== "scenario" ? `/advice?topic=${topic}` : "/advice";
}

/** The public copy of the advice, opened on the document the visitor was
 *  heading for when the door stopped them.
 *
 * The other direction of the same trip. Somebody who opens `/advice` with no
 * session is bounced to `/signin?callbackUrl=/advice`, and what they came to
 * read is public: `/shared/advice` serves it to anyone. Without this they are
 * standing at a door for something that was never locked.
 *
 * The topic is carried, not validated. `/shared/advice` already reads it
 * through `isAdviceTopic` and falls back to the first document, so an unknown
 * one lands somewhere sensible — and validating here would mean pulling the
 * four documents into the sign-in page's imports to check a word.
 *
 * A callback that is not the advice gives the bare address. A run is the case
 * that matters: `/eval/<id>` has a public twin only if that run was published,
 * and sending a stranger to a 404 would be worse than sending them to the top
 * of the advice. */
export function sharedAdviceFor(callbackUrl: string | undefined): string {
  if (!callbackUrl?.startsWith("/advice")) return "/shared/advice";
  const query = callbackUrl.indexOf("?");
  if (query === -1) return "/shared/advice";
  const topic = new URLSearchParams(callbackUrl.slice(query + 1)).get("topic");
  // Only a plain word travels. The value ends up in an address this page
  // builds, and nothing else here would stop a callback carrying something
  // stranger than a document name.
  return topic && /^[a-z]+$/.test(topic)
    ? `/shared/advice?topic=${topic}`
    : "/shared/advice";
}
