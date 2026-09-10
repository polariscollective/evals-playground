// The four advice documents, for whoever has the address.
//
// The third door onto the same texts, and the only one addressed to a human
// without a session. `/advice` shows them to whoever is signed in and lets
// them rewrite them; `/advice.txt` serves one as plain text to an agent
// that only has HTTP; this one hands them to somebody we never invited into
// the application.
//
// Always the defaults, never a profile's override — the rule of
// `/advice.txt`, for the same reason: without a session we do not know
// who is asking, so nothing that depends on who is asking can leave here.
// Serving a stranger the version somebody rewrote for their own agents would
// leak a text written in private.
//
// A server component, unlike `/advice`: the texts are constants of the
// code, there is nothing to wait for, and they therefore ship in the initial
// HTML. The private page cannot — it must first ask for the profile to learn
// whether it carries an override.
//
// All four are rendered here, once, and handed to the client component that
// switches between them. Markdown rendering is the expensive part and it does
// not depend on who is looking, so it belongs on this side of the line.
//
// `renderMarkdown` and `notes-prose`, like the private page: two renderings
// of the same document would end up not resembling each other.
import type { Metadata } from "next";
import { getSessionEmail } from "@/auth";
import { OpenInApp } from "@/components/OpenInApp";
import { adviceReturn } from "@/lib/shared-return";
import { SharedAdviceView } from "@/components/SharedAdviceView";
import { renderMarkdown } from "@/lib/markdown";
import {
  ADVICE_TOPICS,
  DEFAULT_ADVICE,
  isAdviceTopic,
  type AdviceTopic,
} from "@/lib/advice";

// The tab title, and the link preview. Without it, an address pasted into a
// conversation says only "Evals Playground", which does not tell this page
// apart from any other.
export const metadata: Metadata = {
  title: "Advice — Evals Playground",
  description:
    "What an agent needs to know to write an evaluation here, and to read one.",
};

export default async function SharedAdvice({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  // The address without a topic is the one that existed before the advice was
  // split in four, and it is written into prompts that already went out. It
  // keeps landing on the scenario document. Read once, to decide which tab
  // opens: from there the client component holds it, and no click navigates.
  const asked = (await searchParams).topic;
  const initial: AdviceTopic = isAdviceTopic(asked) ? asked : "scenario";

  // `reflow`: the documents are stored wrapped at 78 columns, a writing
  // convenience rather than an intention — see `/advice`, which renders them
  // the same way.
  const rendered = Object.fromEntries(
    ADVICE_TOPICS.map((topic) => [
      topic,
      renderMarkdown(DEFAULT_ADVICE[topic], { reflow: true }),
    ]),
  ) as Record<AdviceTopic, string>;

  // Only decides one word on the link below — see `OpenInApp`. It changes
  // nothing about the documents themselves: this page serves the defaults to
  // everybody, signed in or not, because a profile's own rewrite is private.
  const signedIn = (await getSessionEmail()) !== null;

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-8">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-zinc-500">
          Advice — read only
        </p>
        {/* The tab being read travels with the visitor. Somebody signing in
            from the judge document should come back to the judge document. */}
        <OpenInApp href={adviceReturn(initial)} signedIn={signedIn} />
      </div>
      <SharedAdviceView
        initial={initial}
        sources={DEFAULT_ADVICE}
        rendered={rendered}
      />
    </main>
  );
}
