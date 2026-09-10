"use client";

// The four documents for whoever has the address, all held at once.
//
// The page around this is a server component, and it renders all four markdowns
// before handing them over. So switching tab changes a variable and nothing
// else: no navigation, no fetch, no flash, and the reader who came to compare
// two of them can. The previous version put the topic in `?topic=`, which meant
// a full round trip per click for text that was already a constant of the
// bundle.
//
// `?topic=` still decides which one opens first, because that address is worth
// sharing — "read the analysis one" is a link. It is read once and state takes
// over from there.
import { useState } from "react";
import { CopyText } from "@/components/CopyButton";
import { AdviceTabs } from "@/components/AdviceTabs";
import { ADVICE_LABEL, ADVICE_TOPICS, type AdviceTopic } from "@/lib/advice";

export function SharedAdviceView({
  initial,
  sources,
  rendered,
}: {
  initial: AdviceTopic;
  /** The markdown itself, for the Copy button: what leaves must be the source,
   *  never the HTML the page happens to show. */
  sources: Record<AdviceTopic, string>;
  /** Rendered on the server, once per document — see the page. */
  rendered: Record<AdviceTopic, string>;
}) {
  const [topic, setTopic] = useState<AdviceTopic>(initial);

  return (
    <>
      <h1 className="text-2xl">{ADVICE_LABEL[topic]}</h1>

      <AdviceTabs topic={topic} onSelect={setTopic} />

      <div className="flex flex-wrap items-center gap-2">
        <CopyText value={sources[topic]} title={`Copy: ${ADVICE_LABEL[topic]}`} />
        {/* Two ways in and no third. Copy hands the source to an agent through
            whoever is reading; the MCP connector hands it to one directly, and
            serves that person's own version rather than this default. A plain
            text route sat between them and was worth neither. */}
        <span className="text-xs text-zinc-500">
          Copy it into an agent, or connect the MCP server and let it call{" "}
          <code className="rounded bg-zinc-100 px-1">read_advice</code>.
        </span>
      </div>

      {/* All four are in the DOM, and only the one in front is shown. Rebuilding
          the markup on every click would throw away work the server already did,
          and `hidden` is what keeps a long document's scroll position while the
          reader flicks between two of them. */}
      {ADVICE_TOPICS.map((entry) => (
        <div
          key={entry}
          hidden={entry !== topic}
          // The document scrolls inside its own frame, and the page does not.
          // These are long texts read against the tab strip: a reader comparing
          // two of them should not have to scroll back up to switch.
          className="notes-prose max-h-[calc(100vh-22rem)] w-full overflow-y-auto rounded border border-zinc-200 p-4 text-sm text-zinc-700"
          // Safe: `renderMarkdown` escapes every bit of incoming HTML before
          // producing the only tags it builds itself.
          dangerouslySetInnerHTML={{ __html: rendered[entry] }}
        />
      ))}
    </>
  );
}
