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
