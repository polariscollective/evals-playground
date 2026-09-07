"use client";

// Le titre d'un run, et le pinceau qui le renomme.
//
// Le même composant sert la liste et la page d'un run : le geste est le même,
// et deux implémentations dériveraient — l'une saurait vider un titre, l'autre
// pas. Ce qui change entre les deux, c'est l'habillage du titre au repos, d'où
// `className` et le rendu passé en enfant.
import { useEffect, useRef, useState } from "react";
import { saveRunLabel } from "@/lib/api";

export function RunTitle({
  runId,
  label,
  fallback,
  onSaved,
  className = "",
  editOnClick = false,
  inputClassName = "w-72 max-w-full border border-zinc-300 px-2 py-0.5 text-sm",
  children,
}: {
  runId: string;
  /** Le titre enregistré, ou `null` quand le run n'en a pas. C'est LUI qu'on
   *  édite — jamais le repli, qu'on ne ferait qu'écrire en dur. */
  label: string | null;
  /** Ce qui s'affiche à défaut : le titre du premier scénario, puis l'id. */
  fallback: string;
  /** Prévenir la page que le titre a changé, pour qu'elle relise. */
  onSaved: (next: string | null) => void;
  className?: string;
  /** Cliquer le titre l'ouvre en édition. Vrai sur la page d'un run, où le
   *  titre n'est qu'un `<h1>` ; faux dans la liste, où c'est un lien vers ce
   *  run — un clic y doit naviguer, et voler ce geste rendrait la liste
   *  impraticable. */
  editOnClick?: boolean;
  /** Comment le champ se présente. Par défaut un petit champ de liste ; sur la
   *  page d'un run, on lui passe la tête du titre — serif, deux fois plus gros,
   *  pleine largeur — pour que rien ne saute au moment où il s'ouvre. */
  inputClassName?: string;
  /** Le titre au repos, rendu par l'appelant : un lien dans la liste, un
   *  `<h1>` sur la page du run. */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Le curseur va dans le champ à l'ouverture : sans ça, il faut un second
  // clic pour écrire ce qu'on vient de demander à écrire.
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const open = () => {
    // Le brouillon part du titre enregistré, pas du repli : reprendre le titre
    // du premier scénario l'écrirait en dur au premier enregistrement, et le
    // run cesserait de suivre son scénario s'il était renommé.
    setDraft(label ?? "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const { label: saved } = await saveRunLabel(runId, draft);
      onSaved(saved);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
        {editOnClick ? (
          <span
            role="button"
            tabIndex={0}
            onClick={open}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
            title="Rename this run"
            className="cursor-text"
          >
            {children}
          </span>
        ) : (
          children
        )}
        <button
          type="button"
          onClick={open}
          aria-label="Rename this run"
          title="Rename this run"
          className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-700"
        >
          ✎
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex w-full flex-wrap items-center gap-1.5">
      <input
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Entrée enregistre, Échap renonce : les deux réflexes d'un champ
          // qui s'ouvre sur place. Sans eux, il faut viser un bouton pour
          // sortir d'un geste qu'on a ouvert d'un clic.
          if (e.key === "Enter") void save();
          if (e.key === "Escape") setEditing(false);
        }}
        disabled={busy}
        placeholder={fallback}
        aria-label="Run title"
        className={inputClassName}
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={busy}
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        disabled={busy}
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-40"
      >
        Cancel
      </button>
      {/* Vider le champ n'efface pas le run : ça lui retire son nom, et le
          repli reprend la main. Le dire, parce qu'un champ vide devant un
          bouton « Save » n'inspire pas confiance. */}
      <span className="text-xs text-zinc-500">
        {draft.trim() === "" ? `Empty — will show “${fallback}”` : ""}
      </span>
      {error && (
        <span role="alert" className="text-xs text-red-700">
          {error}
        </span>
      )}
    </span>
  );
}
