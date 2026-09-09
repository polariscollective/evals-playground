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
import type { ProviderInfo } from "@/lib/types";

export function FormatGuide({ providers }: { providers: ProviderInfo[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // The document points at `/advice.txt`, and a copy-pasted document reaches an
  // agent with no host context at all: it needs the whole address, which only
  // the browser knows.
  //
  // Hence the computation on opening and not at render: the server always renders
  // this window closed, so `window` is there as soon as this text exists. An
  // effect laying the origin in state would do the same work in two renders, and
  // the linter refuses it rightly.
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
        className="cursor-pointer text-zinc-600 underline hover:text-zinc-900"
      >
        How to prompt an agent
      </button>

      <Dialog
        open={open}
        title="Ask an agent to write the run"
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
                className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
              >
                Close
              </button>
              <button
                onClick={() => copy(text, "Prompt copied.")}
                className="cursor-pointer rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700"
              >
                {/* An icon alone would be mute about what this button really
                    does: it carries off two pages of text, not a link. */}
                ⧉ Copy the prompt
              </button>
            </div>
          </div>
        }
      >
        <p className="mb-3">
          Describe your experiment to an agent with this, and it will return a
          YAML document you can paste back right above. The prompt already
          carries the format, the rules the tool enforces, and the model
          identifiers currently available — so what comes back loads without
          editing.
        </p>
        {/* An agent that can read a page does without the copy-paste: this address
            returns the same text, in the clear and with no sign-in — and the prompt
            it returns already carries the origin, read on the server side. */}
        {open && (
          <div className="mb-3 flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-2">
            <span className="shrink-0 text-zinc-500">Or give it this link:</span>
            <code className="grow truncate font-mono text-xs">
              {`${window.location.origin}/format.txt`}
            </code>
            <button
              onClick={() =>
                copy(`${window.location.origin}/format.txt`, "Link copied.")
              }
              className="shrink-0 cursor-pointer rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs hover:bg-zinc-50"
            >
              ⧉ Copy link
            </button>
          </div>
        )}
        <pre className="overflow-x-auto rounded border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
          {text}
        </pre>
      </Dialog>
    </>
  );
}
