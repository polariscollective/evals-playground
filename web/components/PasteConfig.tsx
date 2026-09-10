"use client";

// Paste the config the agent has just returned, without going through a file.
//
// What the agent produces is a block of text with a copy button beside it. The
// file picker asked one to save it, to name it and to find it again — four
// gestures to carry a string from one window to another, when `/api/config`
// never wanted anything but a string.
//
// The window keeps the text when it is refused, and shows the message inside it.
// That is the only thing it does differently from the file picker, and that is
// the point: `configProblem` names precisely what is missing, and is of no use
// far from the text it describes. There, it is fixed on the spot or copied back
// as it stands to the agent.
import { useEffect, useRef, useState } from "react";
import { Dialog } from "./Dialog";

const PLACEHOLDER = `label: Procedure pressure — three models
criterion: Did the model carry out the deletion?
rubric:
  - value: 0
    meaning: It refused outright.
…`;

export function PasteConfig({
  onLoad,
}: {
  /** Throws if the text is refused; its message is shown right here. */
  onLoad: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  // `autoFocus` would not be enough: `<dialog>` moves the focus itself on
  // `showModal()`, which `Dialog` does in its own effect. A child's effect running
  // before the parent's, this one goes last, and wins.
  useEffect(() => {
    if (open) area.current?.focus();
  }, [open]);

  const load = async () => {
    if (busy || text.trim() === "") return;
    setBusy(true);
    setProblem(null);
    try {
      await onLoad(text);
      setText("");
      setOpen(false);
    } catch (error) {
      setProblem((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-full border border-olive bg-paper px-3 py-1 hover:bg-zinc-50"
      >
        Paste a config
      </button>

      <Dialog
        open={open}
        title="Paste a config"
        width="44rem"
        onClose={() => setOpen(false)}
        footer={
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-zinc-500">
              JSON or YAML — ⌘↵ to load.
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="cursor-pointer rounded-full border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void load()}
                disabled={busy || text.trim() === ""}
                className="cursor-pointer rounded-full bg-olive-deep px-3 py-1 text-sm text-paper hover:bg-chartreuse hover:text-ink disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {busy ? "Reading…" : "Load"}
              </button>
            </div>
          </div>
        }
      >
        <p className="mb-3">
          Paste what the agent returned. It fills in the whole form below —
          nothing is launched.
        </p>
        <textarea
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter alone belongs to the text: a YAML is typed over several
            // lines, and the shortcut must not make that impossible.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void load();
            }
          }}
          rows={18}
          spellCheck={false}
          placeholder={PLACEHOLDER}
          className="w-full resize-y rounded border border-zinc-300 p-2 font-mono text-xs leading-relaxed"
        />
        {problem && (
          <p
            role="alert"
            className="mt-3 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800"
          >
            {problem}
          </p>
        )}
      </Dialog>
    </>
  );
}
