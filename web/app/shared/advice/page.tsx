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
// `renderMarkdown` and `notes-prose`, like the private page: two renderings
// of the same document would end up not resembling each other.
import type { Metadata } from "next";
import Link from "next/link";
import { CopyText } from "@/components/CopyButton";
import { renderMarkdown } from "@/lib/markdown";
import {
  ADVICE_SUMMARY,
  ADVICE_TOPICS,
  DEFAULT_ADVICE,
  isAdviceTopic,
  type AdviceTopic,
} from "@/lib/advice";

// The tab title, and the link preview. Without it, an address pasted into a
// conversation says only "Evals Playground", which does not tell this page
// apart from any other.
export const metadata: Metadata = {
  title: "Guidelines — Evals Playground",
  description:
    "What an agent needs to know to write an evaluation here, and to read one.",
};

const LABEL: Record<AdviceTopic, string> = {
  scenario: "Writing a scenario",
  batch: "Putting a batch together",
  analysis: "Reading the results",
  judge: "Writing a judge",
};

export default async function SharedAdvice({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  // The address without a topic is the one that existed before the advice was
  // split in four, and it is written into prompts that already went out. It
  // keeps landing on the scenario document.
  const asked = (await searchParams).topic;
  const topic: AdviceTopic = isAdviceTopic(asked) ? asked : "scenario";
  const text = DEFAULT_ADVICE[topic];

  return (
    <main className="mx-auto max-w-6xl space-y-4 p-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Guidelines — read only
        </p>
        <h1 className="font-serif text-2xl font-normal">{LABEL[topic]}</h1>
        <p className="text-sm text-zinc-500">{ADVICE_SUMMARY[topic]}</p>
      </header>

      {/* Four documents read at four different moments, so the reader can see
          what else exists rather than having to be told. */}
      <nav className="flex flex-wrap gap-1 border-b border-zinc-200 pb-2">
        {ADVICE_TOPICS.map((entry) => (
          <Link
            key={entry}
            href={entry === "scenario" ? "/shared/advice" : `/shared/advice?topic=${entry}`}
            className={`rounded px-3 py-1 text-sm ${
              entry === topic
                ? "bg-zinc-900 text-white"
                : "text-zinc-600 hover:bg-zinc-100"
            }`}
          >
            {LABEL[entry]}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        <CopyText value={text} title={`Copy: ${LABEL[topic]}`} />
        {/* The machine-facing twin, named here because this is the page one
            sends to somebody who will in turn hand it to an agent. */}
        <span className="text-xs text-zinc-500">
          The same text as plain text, for an agent:{" "}
          <code className="rounded bg-zinc-100 px-1">
            /advice.txt?topic={topic}
          </code>
        </span>
      </div>

      <div
        className="notes-prose w-full rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700"
        // Safe: `renderMarkdown` escapes every bit of incoming HTML before
        // producing the only tags it builds itself. `reflow`: the documents are
        // stored wrapped at 78 columns, a writing convenience rather than an
        // intention — see `/advice`, which renders them the same way.
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(text, { reflow: true }),
        }}
      />
    </main>
  );
}
