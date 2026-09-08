// The scenario-writing advice, for whoever has the address.
//
// The third door onto the same text, and the only one addressed to a human
// without a session. `/scenarios` shows it to whoever is signed in and lets
// them rewrite it; `/scenario-advice` serves it as plain text to an agent
// that only has HTTP; this one hands it to somebody we never invited into
// the application.
//
// Always `DEFAULT_SCENARIO_ADVICE`, never a profile's override — the rule of
// `/scenario-advice`, for the same reason: without a session we do not know
// who is asking, so nothing that depends on who is asking can leave here.
// Serving a stranger the version somebody rewrote for their own agents would
// leak a text written in private.
//
// A server component, unlike `/scenarios`: the text is a constant of the
// code, there is nothing to wait for, and it therefore ships in the initial
// HTML. The private page cannot — it must first ask for the profile to learn
// whether it carries an override.
//
// `renderMarkdown` and `notes-prose`, like the private page: two renderings
// of the same document would end up not resembling each other.
import type { Metadata } from "next";
import { CopyText } from "@/components/CopyButton";
import { renderMarkdown } from "@/lib/markdown";
import { DEFAULT_SCENARIO_ADVICE } from "@/lib/scenario-advice";

// The tab title, and the link preview. Without it, an address pasted into a
// conversation says only "Evals Playground", which does not tell this page
// apart from any other.
export const metadata: Metadata = {
  title: "Scenario guidelines — Evals Playground",
  description:
    "What an agent needs to know to write a scenario a model will not recognise as a test.",
};

export default function SharedScenarios() {
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-8">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          Scenario guidelines — read only
        </p>
        <h1 className="font-serif text-2xl font-normal">Scenarios</h1>
        <p className="text-sm text-zinc-500">
          What an agent needs to know to write a scenario a model will not
          recognise as a test.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <CopyText
          value={DEFAULT_SCENARIO_ADVICE}
          title="Copy the scenario-writing advice"
        />
        {/* The machine-facing twin, named here because this is the page one
            sends to somebody who will in turn hand it to an agent. */}
        <span className="text-xs text-zinc-500">
          The same text as plain text, for an agent:{" "}
          <code className="rounded bg-zinc-100 px-1">/scenario-advice</code>
        </span>
      </div>

      <div
        className="notes-prose w-full rounded border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700"
        // Safe: `renderMarkdown` escapes every bit of incoming HTML before
        // producing the only tags it builds itself. `reflow`: the document is
        // stored wrapped at 78 columns, a writing convenience rather than an
        // intention — see `/scenarios`, which renders it the same way.
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(DEFAULT_SCENARIO_ADVICE, { reflow: true }),
        }}
      />
    </main>
  );
}
