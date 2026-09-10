"use client";

import { useState } from "react";
import type { PromptPreview as Preview } from "@/lib/prompt-preview";
import { CopyButton } from "@/components/CopyButton";

/** The whole text a model receives, behind one link.
 *
 * Shut to start with, unlike `Collapsible`: this is not what one comes to the
 * page to read. It is what one opens on the day the numbers look wrong, and a
 * screenful of prompt unfolded by default on every judge would bury the form.
 *
 * The system and user messages are shown as one block with a rule between
 * them, because that is the order the model reads them in, and because copying
 * one without the other gives something that cannot be replayed. */
export function PromptPreview({
  label,
  preview,
  variants,
  note,
  dark = false,
}: {
  /** What the link says, and what the open panel is titled. */
  label: string;
  /** The prompt, when there is only one of it. Ignored if `variants` is given. */
  preview?: Preview;
  /** One prompt per scenario, chosen from a list.
   *
   * A judge's prompt opens with the scenario's own system prompt, and the
   * adversary's carries the scenario's own opening message. On a run that has
   * already been played those texts exist, so showing one of them and calling
   * it "the exact prompt" would be true of one row and wrong about the others. */
  variants?: { key: string; label: string; preview: Preview }[];
  /** One sentence on what the tool added to the text that was typed. */
  note?: string;
  /** For the adversary's block, which sits on a dark ground. */
  dark?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(0);

  const shown =
    variants && variants.length > 0
      ? (variants[Math.min(chosen, variants.length - 1)]?.preview ??
        variants[0].preview)
      : preview;
  const full = !shown
    ? ""
    : shown.user
      ? `${shown.system}\n\n---\n\n${shown.user}`
      : shown.system;

  const link = dark
    ? "text-sm text-red-300 underline hover:text-red-100"
    : "text-sm text-teal-700 underline hover:text-teal-900";
  const panel = dark
    ? "space-y-2 rounded border border-zinc-700 bg-zinc-900 p-3"
    : "space-y-2 rounded border border-zinc-300 bg-zinc-50 p-3";
  const muted = dark ? "text-zinc-400" : "text-zinc-500";

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={link}>
        {label}
      </button>
    );
  }

  return (
    <div className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs font-medium ${muted}`}>
          {label}
        </span>
        <div className="flex items-center gap-3">
          <CopyButton
            value={full}
            title="Copy this prompt"
            className={`text-xs underline ${muted}`}
          >
            {(copied) => (copied ? "copied" : "copy")}
          </CopyButton>
          <button
            onClick={() => setOpen(false)}
            className={`text-xs underline ${muted}`}
          >
            close
          </button>
        </div>
      </div>
      {note && <p className={`text-xs ${muted}`}>{note}</p>}
      {variants && variants.length > 1 && (
        <label className={`flex items-center gap-2 text-xs ${muted}`}>
          Shown for
          <select
            value={chosen}
            onChange={(e) => setChosen(Number(e.target.value))}
            className={`cursor-pointer rounded border p-1 text-xs ${
              dark
                ? "border-zinc-700 bg-zinc-950 text-zinc-100"
                : "border-zinc-300 bg-paper text-zinc-900"
            }`}
          >
            {variants.map((variant, index) => (
              <option key={variant.key} value={index}>
                {variant.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap text-xs">
        {full}
      </pre>
    </div>
  );
}
