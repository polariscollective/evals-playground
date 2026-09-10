"use client";

// "How to ask an agent for this": the prompt written out, ready to copy.
//
// The shortcut this window exists to offer: one describes one's experiment to an
// agent, it returns the YAML, one pastes it back into the form. Without it one
// would have to describe the format from memory, and a format described from
// memory produces refused configs.
import { useState } from "react";
import { Dialog } from "./Dialog";
import { runFormat, catalogModelOptions } from "@/lib/run-format";
import { renderMarkdown } from "@/lib/markdown";
import type { ProviderInfo } from "@/lib/types";

export function FormatGuide({ providers }: { providers: ProviderInfo[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Rendered by default. Somebody opening this window is reading a manual, and
  // only the person about to paste it needs to see the characters.
  const [view, setView] = useState<"read" | "source">("read");
  // Built on opening rather than at render: the server always renders this
  // window closed, so the work happens once, when somebody asks for it.
  const text = open
    ? runFormat(
        // Filtered to the favourites of whoever is looking: this dialog promises
        // "the model identifiers currently available", and an identifier one has
        // not ticked is not available — `submit_draft_run` would refuse it.
        catalogModelOptions(providers)
          .filter((model) => model.favorite)
          .map(({ id, label }) => ({ id, label })),
      )
    : "";

  const copy = async (what: string, said: string) => {
    try {
      await navigator.clipboard.writeText(what);
      setCopied(said);
    } catch (error) {
      setCopied(`Could not copy: ${(error as Error).message}`);
    }
    setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="cursor-pointer link-underline"
      >
        How to have an agent write it
      </button>

      <Dialog
        open={open}
        title="Have an agent write the run"
        width="46rem"
        onClose={() => setOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-zinc-500">
              {copied ?? "Paste it to your agent, then paste back the YAML it returns."}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
              >
                Close
              </button>
              <button
                onClick={() => copy(text, "Copied.")}
                className="cursor-pointer rounded-full bg-olive-deep px-3 py-1 text-sm text-paper hover:bg-chartreuse hover:text-ink"
              >
                {/* An icon alone would be mute about what this button really
                    does: it carries off two pages of text, not a link. */}
                ⧉ Copy the format
              </button>
            </div>
          </div>
        }
      >
        <p className="mb-3">
          Describe your experiment to an agent with this, and it will return a
          YAML document you can paste back right above. The text already carries
          the format, every rule the tool enforces, and the model identifiers
          currently available — so what comes back loads without editing.
        </p>
        <p className="mb-3 text-sm text-zinc-500">
          This is one of two ways in. An agent holding the MCP connector reads
          the same document by calling <code>read_format</code>, and can then
          check, save and launch a run without anything passing through you —
          see the <strong>MCP</strong> tab.
        </p>
        <div className="mb-2 flex gap-1 border-b border-zinc-200 pb-2 text-sm">
          {(["read", "source"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setView(mode)}
              className={`cursor-pointer rounded-full px-3 py-1 ${
                view === mode
                  ? "bg-olive-deep text-paper"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {mode === "read" ? "Read it" : "Source"}
            </button>
          ))}
        </div>
        {view === "read" ? (
          <div
            className="notes-prose max-h-[55vh] overflow-y-auto rounded border border-zinc-200 p-4 text-sm text-zinc-700"
            // Safe: `renderMarkdown` escapes every bit of incoming HTML before
            // producing the only tags it builds itself. `reflow`: the document
            // is written wrapped at 78 columns, a writing convenience rather
            // than an intention, the same as the advice documents.
            dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { reflow: true }) }}
          />
        ) : (
          // What Copy carries off, character for character. A page showing
          // something other than what leaves would be a silent lie, the same
          // one the judge prompt's preview already avoids.
          <pre className="max-h-[55vh] overflow-auto rounded border border-zinc-200 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
            {text}
          </pre>
        )}
      </Dialog>
    </>
  );
}
