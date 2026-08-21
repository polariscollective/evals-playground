"use client";

// « Comment demander ça à un agent » : le prompt tout écrit, à copier.
//
// Le raccourci que cette fenêtre existe pour offrir : on décrit son expérience à
// un agent, il rend le YAML, on le dépose dans le formulaire. Sans elle il
// faudrait décrire le format de mémoire, et un format décrit de mémoire produit
// des fichiers refusés.
import { useState } from "react";
import { Dialog } from "./Dialog";
import { agentPrompt } from "@/lib/agent-prompt";
import type { ProviderInfo } from "@/lib/types";

export function PromptGuide({ providers }: { providers: ProviderInfo[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const text = agentPrompt(
    providers.flatMap((provider) =>
      provider.models.map((model) => ({
        id: model.id,
        label: `${provider.label} ${model.label}`,
      })),
    ),
  );

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
              {copied ?? "Paste it to your agent, then load the YAML it returns."}
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
                {/* Une icône seule serait muette pour ce que ce bouton fait
                    vraiment : il emporte deux pages de texte, pas un lien. */}
                ⧉ Copy the prompt
              </button>
            </div>
          </div>
        }
      >
        <p className="mb-3">
          Describe your experiment to an agent with this, and it will return a
          YAML file you can load right above. The prompt already carries the
          format, the rules the tool enforces, and the model identifiers
          currently available — so what comes back loads without editing.
        </p>
        {/* Un agent qui sait lire une page se passe du copier-coller : cette
            adresse rend le même texte, en clair et sans connexion.
            Lue au rendu et non dans un effet, ce que seul permet le fait que ce
            bloc n'existe qu'une fois la fenêtre ouverte : le serveur ne le rend
            jamais, donc `window` y est toujours là. */}
        {open && (
          <div className="mb-3 flex items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-2">
            <span className="shrink-0 text-zinc-500">Or give it this link:</span>
            <code className="grow truncate font-mono text-xs">
              {`${window.location.origin}/prompt`}
            </code>
            <button
              onClick={() =>
                copy(`${window.location.origin}/prompt`, "Link copied.")
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
