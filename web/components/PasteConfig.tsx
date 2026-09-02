"use client";

// Coller la config que l'agent vient de rendre, sans passer par un fichier.
//
// Ce que l'agent produit est un bloc de texte avec un bouton copier à côté. Le
// sélecteur de fichier demandait de l'enregistrer, de le nommer et de le
// retrouver — quatre gestes pour transporter une chaîne d'une fenêtre à
// l'autre, alors que `/api/config` n'a jamais voulu qu'une chaîne.
//
// La fenêtre garde le texte quand il est refusé, et montre le message dedans.
// C'est la seule chose qu'elle fait autrement que le sélecteur de fichier, et
// c'est le point : `configProblem` nomme précisément ce qui manque, et ne sert
// à rien loin du texte qu'il décrit. Là, il se corrige sur place ou se recopie
// tel quel à l'agent.
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
  /** Lève si le texte est refusé ; son message est montré ici même. */
  onLoad: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  // `autoFocus` ne suffirait pas : `<dialog>` déplace le focus lui-même au
  // `showModal()`, que `Dialog` fait dans son propre effet. Un effet d'enfant
  // s'exécutant avant celui du parent, celui-ci passe après, et gagne.
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
        className="cursor-pointer rounded border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50"
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
                className="cursor-pointer rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void load()}
                disabled={busy || text.trim() === ""}
                className="cursor-pointer rounded bg-zinc-900 px-3 py-1 text-sm text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
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
            // Entrée seule appartient au texte : un YAML se tape sur plusieurs
            // lignes, et le raccourci ne doit pas le rendre impossible.
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
